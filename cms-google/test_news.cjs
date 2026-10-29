const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'content/legacy-albums.json'),'utf8'));
// Keep the pre-import fixture independent of the live posts.json, which now
// contains the migrated albums and changes as the owner publishes content.
const real={posts:[{id:'b'.repeat(32),title:'기존 CMS 이야기',excerpt:'수업 기록',category:'class',displayMode:'story',url:'/news/'+'b'.repeat(32)+'.html',publishedAt:'2026-10-29T00:00:00.000Z',media:{}}],migratedArchives:[]};
const source=fs.readFileSync(path.join(root,'content.js'),'utf8');
const alias=fs.readFileSync(path.join(root,'legacy-archive.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function listing(feed, broken=false, sourceCatalog=catalog, kind='news'){
  const grid={innerHTML:''},count={textContent:''},search={value:''},format={value:'all'};
  const buttons=['all','event','competition'].map(category=>({dataset:{category},classList:{toggle(){}},setAttribute(){}}));
  const section={hidden:true,dataset:{cmsSection:kind},querySelector(s){return {'[data-cms-grid]':grid,'[data-cms-count]':count,'[data-cms-search]':search,'[data-cms-format]':format,'[data-cms-filter]':{querySelectorAll:()=>buttons}}[s]}};
  const context={window:{PLIE_CONTENT_CONFIG:{enabled:true,feed:'/content/posts.json'}},document:{querySelectorAll:()=>[section]},fetch:async url=>({ok:!broken,json:async()=>url.includes('legacy-albums')?sourceCatalog:feed})};
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
  // Uploaded/imported again does not make a historical gallery a new post.
  const post=(id,publishedAt,extra={})=>({id,title:id,excerpt:'',url:'/news/'+id+'.html',publishedAt,category:'event',media:{},...extra});
  const titles=view=>[...view.grid.innerHTML.matchAll(/<h2><a[^>]*>(.*?)<\/a><\/h2>/g)].map(match=>match[1]);
  const history={albums:[],publicationHistory:{
    archive:{publishedAt:'2025-10-22T18:30:00Z',sourcePath:'kyunghee-cup.html',commit:'1'.repeat(40)},
    fallback:{publishedAt:'2026-02-30T00:00:00Z',sourcePath:'invalid.html',commit:'2'.repeat(40)}
  }};
  const posts=[
    post('archive','2026-12-01T00:00:00Z',{eventDate:'9999-01-01',updatedAt:'9999-01-01T00:00:00Z'}),
    post('older','2026-10-01T09:00:00Z',{eventDate:'2099-01-01'}),
    post('newest','2026-10-28T15:01:00Z',{eventDate:'1900-01-01'}),
    post('same-b','2026-10-28T14:00:00Z'),
    post('same-a','2026-10-28T14:00:00Z'),
    post('same-day-earlier','2026-10-28T13:59:00Z'),
    post('fallback','2026-10-20T00:00:00Z'),
    post('undated','not a date'),
    post('impossible','2026-02-30T00:00:00Z')
  ];
  const expected=['newest','same-a','same-b','same-day-earlier','fallback','older','archive','impossible','undated'];
  view=await listing({posts},false,history);
  assert.deepEqual(titles(view),expected);
  assert.ok(view.grid.innerHTML.includes('datetime="2026-10-29" title="최초 게시일">2026.10.29</time>'),'Korean calendar date must not use the UTC day');
  assert.ok(view.grid.innerHTML.includes('datetime="2025-10-23" title="최초 게시일">2025.10.23</time>'),'Git history date overrides migration time');
  const edited=posts.map(p=>({...p,updated:'9999-12-31T23:59:59Z',updatedAt:'9999-12-31T23:59:59Z',eventDate:'9999-12-31'})).reverse();
  view=await listing({posts:edited},false,history);
  assert.deepEqual(titles(view),expected,'Editing and stale manual event dates must not change publication ordering');
  view=await listing({posts:edited},false,history,'home');
  assert.deepEqual(titles(view),expected.slice(0,3),'Homepage latest posts must be limited after original-publication sorting');
  const legacyWithDate=structuredClone(catalog.albums[0]);legacyWithDate.publishedAt='2024-01-01T15:30:00Z';
  view=await listing({posts:[post('story','2025-01-01T00:00:00Z')]},false,{albums:[legacyWithDate]});
  assert.deepEqual(titles(view),['story',legacyWithDate.title]);
  assert.ok(view.grid.innerHTML.includes('datetime="2024-01-02"'),'Legacy catalog date works before import even without a history map');
  // Only the exact post ID may select historical metadata; prototype fields
  // and a mismatched legacyKey must never replace another post's publication.
  view=await listing({posts:[post('unrelated','2026-10-29T00:00:00Z',{legacyKey:'archive'}),post('archive','2026-12-01T00:00:00Z')]},false,history);
  assert.deepEqual(titles(view),['unrelated','archive']);
  const inherited=Object.create({inherited:{publishedAt:'9999-01-01T00:00:00Z'}});
  view=await listing({posts:[post('inherited','2024-01-01T00:00:00Z'),post('own','2025-01-01T00:00:00Z')]},false,{albums:[],publicationHistory:inherited});
  assert.deepEqual(titles(view),['own','inherited']);
  console.log('PASS news: preserved posts, migration/tombstones, filters/escaping, immutable upload ordering, Git metadata, timezone dates and stable edits');
})().catch(error=>{console.error(error);process.exitCode=1;});
