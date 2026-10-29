const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const whole=fs.readFileSync(path.join(root,'script.js'),'utf8');
const source=whole.slice(whole.indexOf('(async function showOriginalPublicationDate()'));
assert.ok(source.startsWith('(async function'));
const catalog=JSON.parse(fs.readFileSync(path.join(root,'content/legacy-albums.json'),'utf8'));
async function render(id,metadata={},broken=false){
  const time={textContent:'OLD',dateTime:''};let calls=0;
  const document={querySelector(selector){
    if(selector==='.article-header time')return id?time:null;
    if(selector==='link[rel="canonical"]')return {getAttribute:()=>`https://www.plierg.com/news/${id}.html`};
    if(selector==='script[type="application/ld+json"]')return {textContent:JSON.stringify(metadata)};
    return null;
  }};
  await vm.runInNewContext(source,{document,fetch:async()=>{calls++;if(broken)throw Error('Offline');return {ok:true,json:async()=>catalog};}});
  return {time,calls};
}
(async()=>{
  let result=await render('1e98e803d01fa54a07c0bfb1d9b056a7',{datePublished:'2026-10-29T09:11:45Z',eventDate:'2025-09-06'});
  assert.equal(result.time.textContent,'2026.04.26');
  assert.equal(result.time.dateTime,'2026-04-26T08:40:38.000Z');
  result=await render('a'.repeat(32),{datePublished:'2026-10-28T16:00:00Z'});
  assert.equal(result.time.textContent,'2026.10.29');
  result=await render('a'.repeat(32),{datePublished:'2026-10-28T16:00:00Z'},true);
  assert.equal(result.time.textContent,'2026.10.29');
  result=await render('a'.repeat(32),{datePublished:'invalid'});
  assert.equal(result.time.textContent,'OLD');
  result=await render('');assert.equal(result.calls,0);
  console.log('PASS article dates: original Git addition, immutable publication fallback, Korean timezone, offline behavior, no event-date input.');
})().catch(error=>{console.error(error);process.exitCode=1;});
