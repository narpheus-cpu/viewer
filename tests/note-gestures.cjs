const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const target=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));let checks=0;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
 for(const mode of ['pointer-touch','legacy-touch','mouse']){
  const context=await browser.newContext({viewport:{width:360,height:640},hasTouch:true,isMobile:mode!=='mouse'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  if(mode==='legacy-touch')await page.addInitScript(()=>Object.defineProperty(window,'PointerEvent',{value:undefined,configurable:true}));
  await page.goto(pathToFileURL(target).href);await page.evaluate(()=>readerReady);
  await page.locator('#inputText').fill('읽는 본문 문장입니다. '.repeat(200)+'\n\n각주단어〔단어의 설명입니다.\n긴 내용도 안전하게 읽습니다.〕는 각주가 있는 문장입니다.\n\n'+'이어지는 본문 문장입니다. '.repeat(200));
  await page.locator('#openViewerBtn').click();await page.waitForFunction(()=>pages.length>5&&!restoreInProgress);
  const cdp=await context.newCDPSession(page);
  const state=()=>page.evaluate(()=>({index:pageIndex,anchor:readerAnchor(),splits:readerStats.splits}));
  const open=()=>page.evaluate(()=>readerNoteIsOpen());
  async function atNote(){
   await page.evaluate(()=>{pageIndex=pages.findIndex(html=>html.includes('data-reader-note='));readerChooseAnchor(pageAnchors[pageIndex]);render();});
   const box=await page.locator('#pageSpread [data-reader-note]').first().boundingBox();return {x:box.x+Math.min(15,box.width/2),y:box.y+box.height/2};
  }
  async function down(p){if(mode==='mouse'){await page.mouse.move(p.x,p.y);await page.mouse.down();}else await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});}
  async function up(){if(mode==='mouse')await page.mouse.up();else await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(90);}
  async function tap(p){await down(p);await page.waitForTimeout(50);await up();}
  let p=await atNote();const colors=await page.locator('#pageSpread [data-reader-note]').first().evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,underline:getComputedStyle(el).textDecorationLine,style:getComputedStyle(el).textDecorationStyle,italic:getComputedStyle(el).fontStyle,select:getComputedStyle(el).userSelect}));
  assert.deepEqual(colors,{color:'rgb(0, 0, 0)',background:'rgb(229, 229, 229)',underline:'underline',style:'dotted',italic:'italic',select:'none'});checks++;
  await page.emulateMedia({colorScheme:'dark'});assert.deepEqual(await page.locator('#pageSpread [data-reader-note]').first().evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})),{color:'rgb(0, 0, 0)',background:'rgb(229, 229, 229)'});checks++;
  await page.emulateMedia({colorScheme:'light'});
  const prevented=await page.locator('#pageSpread [data-reader-note]').first().evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})));
  assert.equal(prevented,true);checks++;
  const rect=await page.locator('#pageSpread').boundingBox();let before=await state();await tap(p);
  assert.equal(await open(),false);assert.equal((await state()).index,before.index+(p.x-rect.x<rect.width/2?-1:1));checks+=2;
  for(const side of ['left','right']){
   await atNote();before=await state();await tap({x:rect.x+rect.width*(side==='left'?.1:.9),y:rect.y+rect.height*.7});
   assert.equal((await state()).index,before.index+(side==='left'?-1:1));assert.equal(await open(),false);checks+=2;
  }
  await atNote();before=await state();const right={x:rect.x+rect.width*.9,y:rect.y+rect.height*.7};await tap(right);await tap(right);
  assert.equal((await state()).index,before.index+2);checks++;
  p=await atNote();before=await state();await down(p);await page.waitForTimeout(650);
  assert.equal(await open(),true);assert.equal(await page.locator('#readerNoteContent').innerText(),'단어의 설명입니다.\n긴 내용도 안전하게 읽습니다.');checks+=2;
  await up();assert.deepEqual(await state(),before);assert.equal(await open(),true);checks+=2;
  await page.locator('#closeReaderNote').tap();await page.waitForTimeout(150);assert.deepEqual(await state(),before);checks++;
  p=await atNote();before=await state();await down(p);await page.waitForTimeout(150);
  const moved={x:p.x+20,y:p.y};
  if(mode==='mouse')await page.mouse.move(moved.x,moved.y);else await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved]});
  await page.waitForTimeout(650);await up();assert.equal(await open(),false);assert.equal((await state()).index,before.index);checks+=2;
  p=await atNote();before=await state();await down({x:rect.x+rect.width*.9,y:rect.y+rect.height*.7});await page.waitForTimeout(650);await up();
  assert.equal(await open(),false);assert.equal((await state()).index,before.index);checks+=2;
  if(mode!=='mouse'){
   p=await atNote();before=await state();await down(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await page.waitForTimeout(650);
   assert.equal(await open(),false);assert.equal((await state()).index,before.index);checks+=2;
   p=await atNote();await down(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0},{x:p.x+40,y:p.y+40,id:1}]});
   await page.waitForTimeout(650);assert.equal(await open(),false);checks++;await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  }
  p=await atNote();await down(p);await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.waitForTimeout(650);await up();assert.equal(await open(),false);checks++;
  const trigger=page.locator('#pageSpread [data-reader-note]').first();await atNote();await trigger.focus();before=await state();await page.keyboard.press('Enter');
  assert.equal(await open(),true);await page.keyboard.press('Escape');assert.deepEqual(await state(),before);checks+=2;
  p=await atNote();before=await state();await down(p);
  await page.evaluate(()=>{viewerSettings.padTop+=1;applyViewerSettings(false);scheduleRepaginate(0);});
  await page.waitForTimeout(650);assert.equal(await open(),true);await up();assert.deepEqual(await state(),before);checks+=2;
  await page.locator('#closeReaderNote').tap();await page.waitForFunction(()=>!restoreInProgress&&readerState.layout===getLayoutSignature());
  assert.equal(await page.evaluate(()=>readerAnchor()),before.anchor);checks++;
  assert.deepEqual(errors,[]);checks++;await context.close();
 }
 console.log(checks+' note hold, short page tap, touch fallback, cancellation, grayscale and keyboard checks passed: '+target);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
