// Build the bundled timeline from a UTF-8 JSON array of {name,text} source files.
// Usage: node tools/build-timeline.cjs /absolute/path/sources.json
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),core=require('../timeline-core.js');
const repo=path.resolve(__dirname,'..'),input=process.argv[2];if(!input)throw Error('Provide the source JSON file');
const sources=JSON.parse(fs.readFileSync(input,'utf8')),all=[];let headings=0;
if(!Array.isArray(sources)||!sources.length)throw Error('No timeline sources');
for(const s of sources){
 if(typeof s.name!=='string'||typeof s.text!=='string')throw Error('Invalid timeline source');
 const expected=(s.text.match(/^\s*\[(?:BCE|CE)-(?:Y|C)\d+\]/gmi)||[]).length,parsed=core.parseText(s.text,s.name);
 if(!parsed.length||(expected&&parsed.length!==expected))throw Error('Incomplete parse: '+s.name+' '+parsed.length+'/'+expected);
 headings+=expected;all.push(...parsed);
}
const entries=core.merge(all);if(entries.length!==all.length)throw Error('Overlapping duplicate record keys in source files');
const version=crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0,16),files=new Map();let part=0,records={},size=0,index=[];
function flush(){if(!Object.keys(records).length)return;files.set('part-'+String(part).padStart(3,'0')+'.json',JSON.stringify({records}));part++;records={};size=0;}
for(const e of entries){const bytes=Buffer.byteLength(e.text);if(size&&size+bytes>32768)flush();records[e.id]=e.text;size+=bytes;index.push({id:e.id,from:e.from,to:e.to,title:e.title,chunk:part});}flush();
files.set('index.json',JSON.stringify({schema:1,version,name:'비교 역사 연표',files:sources.length,entries:index}));
for(const sub of ['timelines/default','android/app/src/main/assets/timelines/default']){
 const dir=path.join(repo,sub);fs.mkdirSync(dir,{recursive:true});
 // Remove only obsolete generated JSON files from these two explicit data folders.
 for(const name of fs.readdirSync(dir))if(/^(?:index|part-\d{3})\.json$/.test(name)&&!files.has(name))fs.unlinkSync(path.join(dir,name));
 for(const [name,text] of files)fs.writeFileSync(path.join(dir,name),text);
}
const ui=path.join(repo,'timeline-ui.js'),script=fs.readFileSync(ui,'utf8');fs.writeFileSync(ui,script.replace(/const READER_TIMELINE_DEFAULT_VERSION='[a-f0-9]+';/,"const READER_TIMELINE_DEFAULT_VERSION='"+version+"';"));
console.log(JSON.stringify({files:sources.length,headings,entries:entries.length,parts:part,version,bytes:[...files.values()].reduce((n,t)=>n+Buffer.byteLength(t),0),first:index[0],last:index.at(-1)}));
