// Controlled storage-failure regression: manual read position must survive quota
// and privacy-mode localStorage failures without revealing future records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','reader-insights-data.js'),'utf8');
const data=new Map(),window={};
const storage={
 getItem:k=>data.get(k)??null,
 setItem:(k,v)=>data.set(k,v),
 removeItem:k=>data.delete(k)
};
new Function('window','localStorage',code)(window,storage);
const D=window.ReaderInsightsData;
const body='독서 정보 읽기 범위를 검증하기 위해 서로 다른 위치를 가진 문장을 나란히 적는다.';
assert.equal(D.getReadState(body).hasRecord,false);
D.markSeen(body,12);
assert.equal(D.getReadState(body).seen,12);
assert.equal(D.getReadState(body).mode,'sequential');
const before=storage.setItem;
storage.setItem=()=>{throw Error('QuotaExceededError')};
D.setSeen(body,3);
assert.deepEqual({seen:D.getReadState(body).seen,mode:D.getReadState(body).mode},{seen:3,mode:'manual'});
D.markSeen(body,8);
assert.equal(D.getSeen(body),8);
assert.equal(D.getReadState(body).hasRecord,true);
storage.setItem=before;
D.setSeen(body,4);
assert.equal(D.getSeen(body),4);
const persisted=[...data.values()].find(x=>x.includes('"seen":4'));
assert.ok(persisted,'Recovered storage write replaces ephemeral progress');
console.log('7 localStorage failure, backward-correction and recovery checks passed');
