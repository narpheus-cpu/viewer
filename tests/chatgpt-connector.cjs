const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createRuntime,startConnector,validateIdentity,buildInput,diskVault}=require('../connector/server.cjs');
let checks=0;
const handlers=new Map();let nextPort=20000;
function httpFactory(handler){let port;return {headersTimeout:0,requestTimeout:0,once(){return this;},listen(p,host,callback){assert.equal(host,'127.0.0.1');port=p||nextPort++;handlers.set(port,handler);callback();},address(){return {port};},close(){handlers.delete(port);}};}
async function localFetch(url,options={}){
 const {Readable}=require('node:stream'),u=new URL(url),headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));headers.host=u.host;
 const req=Readable.from(options.body?[Buffer.from(options.body)]:[]);Object.assign(req,{url:u.pathname+u.search,method:options.method||'GET',headers});
 return new Promise((resolve,reject)=>{let status=200,head={};const res={headersSent:false,setHeader(k,v){head[k]=v;},writeHead(code,values={}){status=code;Object.assign(head,values);this.headersSent=true;},end(body=''){resolve(new Response(body,{status,headers:head}));}};Promise.resolve(handlers.get(Number(u.port))(req,res)).catch(reject);});
}
(async()=>{
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 function jwt(claims={}){const h=encode({alg:'RS256',kid:'test-key'}),p=encode({iss:'https://auth.openai.com',sub:'user1',aud:'oaiapp_test',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),nonce:'nonce',email:'test@example.invalid',...claims});return h+'.'+p+'.'+crypto.sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');}
 const valid=jwt();assert.equal(validateIdentity(valid,{keys:[jwk]},'oaiapp_test','nonce').sub,'user1');checks++;
 for(const changed of [{iss:'https://evil.invalid'},{aud:'other'},{exp:1},{nonce:'bad'},{sub:''},{iat:0},{azp:'other-client'}]){assert.throws(()=>validateIdentity(jwt(changed),{keys:[jwk]},'oaiapp_test','nonce'));checks++;}
 assert.throws(()=>validateIdentity(valid.slice(0,-10)+'tampered',{keys:[jwk]},'oaiapp_test','nonce'));assert.throws(()=>validateIdentity(valid,{keys:[]},'oaiapp_test','nonce'));assert.throws(()=>validateIdentity(valid,{keys:[jwk]},'oaiapp_test','nonce','other-user'));checks+=3;
 const body=buildInput({text:'선택 문장',prompt:'설명: {{본문}}',model:'test-model'});assert.deepEqual(body,{model:'test-model',input:[{role:'user',content:'설명: 선택 문장'}],store:false,stream:true});checks++;
 for(const input of [{text:'',prompt:'',model:'m'},{text:'x'.repeat(32001),prompt:'',model:'m'},{text:'a',prompt:'x'.repeat(16001),model:'m'},{text:'a',prompt:'p',model:''}]){assert.throws(()=>buildInput(input));checks++;}
 let saved=null,authUrl='',exchanges=0,refreshes=0,responses=0,revoked=false,mode='ok',lastBody;
 const vault={load:()=>saved,save:value=>{saved=JSON.parse(JSON.stringify(value));}};
 const fetcher=async(url,options={})=>{
  url=String(url);if(url.endsWith('/.well-known/jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/.well-known/openid-configuration'))return Response.json({revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
  if(url.endsWith('/oauth/revoke')){revoked=true;return new Response('',{status:200});}
  if(url.endsWith('/oauth/token')){const p=new URLSearchParams(options.body);assert.equal(p.get('resource'),'https://api.openai.com/v1');assert.equal(p.get('client_id'),'oaiapp_test');checks+=2;
   if(p.get('grant_type')==='refresh_token'){refreshes++;return Response.json({access_token:'refreshed-secret',refresh_token:'rotated-refresh',expires_in:3600});}
   exchanges++;const a=new URL(authUrl);assert.equal(p.get('redirect_uri'),a.searchParams.get('redirect_uri'));assert.equal(crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url'),a.searchParams.get('code_challenge'));checks+=2;
   return Response.json({access_token:'private-access-token',refresh_token:'private-refresh-token',id_token:jwt({nonce:a.searchParams.get('nonce')}),scope:'openid email profile resource.invoke chatgpt.tokens.use.direct offline_access',expires_in:3600});
  }
  if(url.endsWith('/models')){assert.ok(options.headers.Authorization.startsWith('Bearer '));checks++;return Response.json({models:[{slug:'test-model',display_name:'Test Model',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});}
  if(url.endsWith('/responses')){responses++;lastBody=JSON.parse(options.body);assert.equal(lastBody.store,false);assert.equal(lastBody.stream,true);checks+=2;
   if(mode==='blocked')return new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new Error('aborted')));}}),{headers:{'Content-Type':'text/event-stream'}});
   const events=[{type:'response.output_text.delta',delta:'설명: 한글 <img src=x>도 글자로 표시.'},mode==='failed'?{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}:mode==='incomplete'?{type:'response.incomplete'}:{type:'response.completed'}];
   if(mode==='interrupted')events.pop();const bytes=Buffer.from(events.map(x=>'data: '+JSON.stringify(x)+'\r\n\r\n').join(''));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.subarray(i,i+7));c.close();}}));
  }
  throw Error('Unexpected URL '+url);
 };
 let runtime=await createRuntime({vault,fetcher,httpFactory,openBrowser:url=>{authUrl=url;}});
 let app;
 try{
  await runtime.rpc('signin');let a=new URL(authUrl);assert.equal(a.origin,'https://auth.openai.com');assert.equal(a.searchParams.get('client_id'),'dynamic_agent_client');assert.ok(a.searchParams.get('ext_agent_host_id').startsWith('urn:uuid:'));assert.equal(a.searchParams.get('agent_name_hint'),'Ebook Viewer');checks+=4;
  const callback=a.searchParams.get('redirect_uri');assert.equal((await localFetch(callback+'?state=wrong&code=x')).status,400);assert.equal(exchanges,0);checks+=2;
  assert.equal((await localFetch(callback+'?'+new URLSearchParams({state:a.searchParams.get('state'),code:'test-code',client_id:'oaiapp_test'}))).status,200);checks++;
  let status=await runtime.rpc('status');assert.equal(status.connected,true);assert.equal(status.plan,true);assert.equal(JSON.stringify(status).includes('private-access-token'),false);checks+=3;
  assert.deepEqual((await runtime.rpc('models')).models,[{slug:'test-model',display_name:'Test Model'}]);checks++;
  async function finished(id){for(let i=0;i<100;i++){const p=await runtime.rpc('poll',{id});if(p.done)return p;await new Promise(r=>setTimeout(r,5));}throw Error('Job did not finish');}
  const request={text:'한 문장',prompt:'설명해',model:'test-model'};let task=await runtime.rpc('ask',request),result=await finished(task.id);assert.equal(result.error,'');assert.equal(result.text,'설명: 한글 <img src=x>도 글자로 표시.');assert.equal(lastBody.input[0].content,'설명해\n\n선택한 본문:\n한 문장');checks+=3;
  for(mode of ['failed','incomplete','interrupted']){task=await runtime.rpc('ask',request);result=await finished(task.id);assert.ok(result.error);assert.ok(result.text.startsWith('설명:'));checks+=2;}
  mode='blocked';task=await runtime.rpc('ask',request);await new Promise(r=>setTimeout(r,20));await assert.rejects(runtime.rpc('ask',request));await runtime.rpc('cancel',{id:task.id});result=await runtime.rpc('poll',{id:task.id});assert.equal(result.done,true);assert.match(result.error,/중지/);checks+=3;
  const active=status.active;await runtime.rpc('signout');assert.equal(revoked,true);assert.equal((await runtime.rpc('status')).connected,false);assert.equal(saved.accounts[0].client_id,'oaiapp_test');assert.equal(saved.accounts[0].access_token,undefined);checks+=4;
  await runtime.rpc('signin',{account:active});a=new URL(authUrl);assert.equal(a.searchParams.get('client_id'),'oaiapp_test');assert.equal(a.searchParams.has('agent_name_hint'),false);checks+=2;
  await localFetch(a.searchParams.get('redirect_uri')+'?'+new URLSearchParams({state:a.searchParams.get('state'),code:'again'}));assert.equal((await runtime.rpc('status')).connected,true);checks++;
  runtime.close();saved.accounts[0].expires_at=0;runtime=await createRuntime({vault,fetcher,httpFactory,openBrowser:()=>{}});await runtime.rpc('models');assert.equal(refreshes,1);assert.equal(saved.accounts[0].refresh_token,'rotated-refresh');checks+=2;
  app=await startConnector({runtime,port:0,launch:false,httpFactory});
  const call=(key,origin='')=>localFetch(app.origin+'/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Key':key,...(origin?{Origin:origin}:{})},body:JSON.stringify({action:'status',params:{}})});
  assert.equal((await call('wrong')).status,403);assert.equal((await call(app.key,'https://evil.invalid')).status,403);assert.equal((await call(app.key,'https://narpheus-cpu.github.io')).status,200);assert.equal((await call(app.key)).status,200);checks+=4;
  const pairing=await (await localFetch(app.origin+'/pair')).text();assert.ok(pairing.includes('https://narpheus-cpu.github.io'));assert.equal(pairing.includes('private-access-token'),false);checks+=2;
  const dir=fs.mkdtempSync(path.join(path.resolve(__dirname,'../../'),'gpt-vault-test-'));const disk=diskVault(dir);disk.save({token:'test-secret-only'});assert.deepEqual(disk.load(),{token:'test-secret-only'});checks++;if(process.platform==='win32'){assert.equal(fs.readFileSync(path.join(dir,'accounts.bin')).includes(Buffer.from('test-secret-only')),false);checks++;}fs.unlinkSync(path.join(dir,'accounts.bin'));fs.rmdirSync(dir);
  console.log(checks+' OAuth, PKCE, ID-token validation, model catalog, SSE, cancellation, CORS and protected storage checks passed.');
 }finally{app?.close();runtime.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
