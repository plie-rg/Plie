const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'content/legacy-albums.json'),'utf8'));
const real=JSON.parse(fs.readFileSync(path.join(root,'content/posts.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const alias=fs.readFileSync(path.join(root,'legacy-archive.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function listing(feed, broken=false){
  const grid={innerHTML:''},count={textContent:''},search={value:''},format={value:'all'};
  const buttons=['all','event','competition'].map(category=>({dataset:{category},classList:{toggle(){}},setAttribute(){}}));
  const section={hidden:true,dataset:{cmsSection:'news'},querySelector(s){return {'[data-cms-grid]':grid,'[data-cms-count]':count,'[data-cms-search]':search,'[data-cms-format]':format,'[data-cms-filter]':{querySelectorAll:()=>buttons}}[s]}};
  const context={window:{PLIE_CONTENT_CONFIG:{enabled:true,feed:'/content/posts.json'}},document:{querySelectorAll:()=>[section]},fetch:async url=>({ok:!broken,json:async()=>url.includes('legacy-albums')?catalog:feed})};
  vm.runInNewContext(source,context);await tick();return {grid,count,search,format,buttons};
}
async function legacy(feed, broken=false){
  const archive={hidden:true,dataset:{legacyArchive:'kyunghee-cup'}},message={textContent:''},status={hidden:false,querySelector:()=>message};let destination='';
  vm.runInNewContext(alias,{window:{},document:{querySelector:s=>s.includes('legacy')?archive:status},fetch:async()=>({ok:!broken,json:async()=>feed}),location:{replace:url=>destination=url}});await tick();return {archive,status,message,destination};
}
(async()=>{
  // A live CMS story and both old albums share one list before Drive migration.
  let view=await listing(real);
  assert.equal((view.grid.innerHTML.match(/class="journal-card"/g)||[]).length,real.posts.length+2);
  for(const p of real.posts)assert.ok(view.grid.innerHTML.includes(p.url));
  view.format.value='gallery';view.format.onchange();assert.equal(view.count.textContent,'2개의 소식');
  view.search.value='정기발표회';view.search.oninput();assert.equal(view.count.textContent,'1개의 소식');
  view.search.value='';view.buttons[2].onclick();assert.equal(view.count.textContent,'1개의 소식');
  const imported=catalog.albums.map(a=>({...a,legacyKey:a.key,url:'/news/'+a.id+'.html',media:{},publishedAt:'2026-10-29T00:00:00.000Z'}));
  const migrated={posts:[...real.posts,...imported],migratedArchives:catalog.albums.map(a=>a.key)};
  view=await listing(migrated);assert.equal((view.grid.innerHTML.match(/class="journal-card"/g)||[]).length,real.posts.length+2);
  assert.ok(!view.grid.innerHTML.includes('href="/kyunghee-cup.html"'));
  // An unpublished/deleted imported album must never return from the catalog fallback.
  view=await listing({...migrated,posts:real.posts});assert.equal((view.grid.innerHTML.match(/class="journal-card"/g)||[]).length,real.posts.length);
  view=await listing({posts:[{title:'<img onerror=x>',excerpt:'<script>x</script>',url:'/news/ok.html',category:'event',media:{}}],migratedArchives:migrated.migratedArchives});
  assert.ok(!view.grid.innerHTML.includes('<script>'));assert.ok(view.grid.innerHTML.includes('&lt;script&gt;'));
  view=await listing({posts:[{title:'Unsafe',url:'javascript:alert(1)'}],migratedArchives:migrated.migratedArchives});assert.ok(!view.grid.innerHTML.includes('javascript:'));
  view=await listing(real,true);assert.ok(view.grid.innerHTML.includes('불러오지 못했습니다'));
  let page=await legacy(real);assert.equal(page.archive.hidden,false);assert.equal(page.status.hidden,true);
  page=await legacy(migrated);assert.equal(page.destination,imported[0].url);assert.equal(page.archive.hidden,true);
  page=await legacy({...migrated,posts:real.posts});assert.equal(page.archive.hidden,true);assert.ok(page.message.textContent.includes('공개 중인 사진첩이 아닙니다'));
  page=await legacy(real,true);assert.equal(page.archive.hidden,true);assert.ok(page.message.textContent.includes('불러오지 못했습니다'));
  console.log('PASS news: existing posts preserved, unified fallback, filters/search, migration dedupe, tombstones, safe aliases and escaping');
})().catch(error=>{console.error(error);process.exitCode=1;});
