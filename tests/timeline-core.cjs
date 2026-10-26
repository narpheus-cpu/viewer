const assert=require('node:assert/strict'),core=require('../timeline-core.js'),fs=require('fs'),path=require('path');let checks=0;
const positives=['252년','서기 252년','서기252년','기원후 252년','기원 후 252년','AD 252','A.D. 252년','A. D. 252','ad252','CE 252년','C.E. 252년','252 AD','252 A.D.','252년 C.E.','252 CE','서력 252년','주후252년','公元252年','西元252年'];
const negatives=['기원전 155년','기원 전155년','서기전 155년','서기 전155년','BC 155년','B.C. 155','BCE155','B.C.E. 155년','155 BC','155 B.C.E.','155년 BCE','주전155년','公元前155年','紀元前155年'];
for(const t of positives){assert.deepEqual(core.years(t).map(x=>x.year),[252],t);checks++}for(const t of negatives){assert.deepEqual(core.years(t).map(x=>x.year),[-155],t);checks++}
for(const t of ['0년','AD 0','BC 0','12345678년','abcAD 252','r182년','1.5년']){assert.deepEqual(core.years(t),[],t);checks++}
assert.deepEqual(core.years('서기 1,000년과 BC 1,000년').map(x=>x.year),[1000,-1000]);assert.deepEqual(core.years('기원전 202~201년, 서기 252~254년').map(x=>x.year),[-202,-201,252,254]);checks+=2;
for(const t of ['기원전 6세기','기원전 6 세기','기원후 6세기','서기 6세기경','AD 6세기','BC 6C','BC 6 C','B.C.E. 6 C.','AD 6 century','6th century BC','기원전 6~5세기','기원전 6–5 C','기원전 6~기원전 5세기']){assert.deepEqual(core.years(t),[],t);checks++;}
assert.deepEqual(core.years('기원전 6세기와 기원전 155년, 서기 100년 C.E.').map(x=>x.year),[-155,100]);checks++;
const parsed=core.merge(core.parseText('기원전 1년\n-한반도\nBC 내용\n\n기원후 1년\n-동양\nAD 내용\n\nC.E. 252년\n-유럽\n내용'));assert.equal(parsed.length,3);assert.deepEqual(parsed.map(e=>e.from),[-1,1,252]);assert.equal(core.nearest(parsed,2),1);assert.equal(core.nearest(parsed,-2),0);checks+=4;
const centuries=core.merge(core.parseText('[BCE-C050] 기원전 50세기 | 기원전 5000~4901년\n-한반도\n본문 서기 252년\n[BCE-C049] 기원전 49세기 | 기원전 4900~4801년\n내용\n[저장 경계]\n기원전 20년'));assert.equal(centuries.length,2);assert.equal(centuries[0].from,-5000);assert.equal(centuries[0].to,-4901);assert.equal(core.nearest(centuries,-4950),0);assert.equal(core.nearest(centuries,252),1);checks+=5;
const index=JSON.parse(fs.readFileSync(path.join(__dirname,'../timelines/default/index.json')));assert.equal(index.entries.length,456);assert.equal(index.entries[0].from,-5000);assert.equal(index.entries.at(-1).to,2026);checks+=3;
console.log(checks+' year variants, BCE/CE boundaries, ranges, isolated headings, centuries and supplied dataset checks passed.');
