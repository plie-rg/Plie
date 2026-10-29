const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=__dirname,site=path.dirname(root),owner='plie0312@gmail.com';
const catalog=JSON.parse(fs.readFileSync(path.join(site,'content/legacy-albums.json'),'utf8'));
const keys=['kyunghee-cup','recital-2026'];
let active=owner,effective=owner,state,writes=0,requests=[],remoteCatalog,lockAvailable=true;
const cache=new Map(),cacheApi={get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)};
const props=new Map([['CMS_GITHUB_TOKEN','test-placeholder'],['CMS_INSTANCE_ID','f'.repeat(32)]]);
const context=vm.createContext({console,Session:{getActiveUser:()=>({getEmail:()=>active}),getEffectiveUser:()=>({getEmail:()=>effective})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
 CacheService:{getUserCache:()=>cacheApi,getScriptCache:()=>cacheApi},
 LockService:{getScriptLock:()=>({tryLock:()=>lockAvailable,waitLock:()=>{if(!lockAvailable)throw Error('locked');},releaseLock:()=>{}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>[...Buffer.from(s,'base64')],newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')}),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'}},
 HtmlService:{createHtmlOutputFromFile:name=>({getContent:()=>fs.readFileSync(path.join(root,name+'.html'),'utf8')})},
 UrlFetchApp:{fetch:()=>({getResponseCode:()=>404,getContentText:()=>'{"error":"not deployed in test"}'})}
});
vm.runInContext(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),context);
const clone=value=>JSON.parse(JSON.stringify(value));
context.cmsState_=()=>clone(state);context.cmsWrite_=value=>{state=clone(value);writes++;};
context.cmsFile_=()=>{throw Error('Imported public photos must not be copied from Drive');};
const priorId='b'.repeat(32),draftId='c'.repeat(32),priorDraft={title:'Already published',excerpt:'Keep me',category:'competition',branch:'all',coverId:'',blocks:[{type:'text',text:'Existing content'}]};
function reset(){
 active=owner;effective=owner;lockAvailable=true;requests=[];writes=0;cache.clear();remoteCatalog=clone(catalog);
 state={posts:{[priorId]:{id:priorId,draft:{...clone(priorDraft),title:'Private pending edit'},published:{...clone(priorDraft),publishedAt:'2026-10-29T00:00:00.000Z',updatedAt:'2026-10-29T00:00:00.000Z'},revision:3,updated:'2026-10-29T00:00:00.000Z'},[draftId]:{id:draftId,draft:clone(priorDraft),published:null,revision:1,updated:'2026-10-28T00:00:00.000Z'}},media:{},publication:{phase:'ready'}};
}
function call(action,payload={}){return clone(context.cmsRequest(action,payload));}
function csrf(){return call('session').value.csrf;}
context.cmsGithub_=(url,method,body)=>{
 requests.push({url,method,body});
 if(url==='/contents/content/legacy-albums.json?ref=main')return {encoding:'base64',content:Buffer.from(JSON.stringify(remoteCatalog)).toString('base64')};
 if(url==='/git/ref/heads/main')return {object:{sha:'base'}};
 if(url==='/git/commits/base')return {tree:{sha:'base-tree'}};
 if(url.startsWith('/git/trees/base-tree')){
   const files=new Set(catalog.albums.flatMap(a=>Object.values(a.media).flatMap(m=>[m.sourcePath,m.thumbnailPath])));
   return {tree:[{path:'content/cms-manifest.json',sha:'manifest',type:'blob',size:1},{path:'sitemap.xml',sha:'sitemap',type:'blob',size:1},...Array.from(files,p=>({path:p,sha:crypto.createHash('sha1').update(p).digest('hex'),type:'blob',size:1}))]};
 }
 if(url==='/git/blobs/manifest')return {content:Buffer.from(JSON.stringify({version:1,ownerId:props.get('CMS_INSTANCE_ID'),files:['content/posts.json','content/release.json']})).toString('base64')};
 if(url==='/git/blobs/sitemap')return {content:Buffer.from('<urlset><url><loc>https://www.plierg.com/news/</loc></url></urlset>').toString('base64')};
 if(url==='/git/blobs')return {sha:crypto.createHash('sha1').update(body.content).digest('hex')};
 if(url==='/git/trees')return {sha:'next-tree'};
 if(url==='/git/commits')return {sha:'next-commit'};
 if(url==='/git/refs/heads/main'){assert.equal(body.force,false);return {};}
 throw Error('Unexpected API '+url);
};
reset();
for(const who of ['', 'someone@example.com']){active=who;assert.equal(call('import-archives',{csrf:'forged'}).ok,false);assert.throws(()=>context.importPlieArchives());}
active=owner;effective='someone@example.com';assert.equal(call('import-archives').ok,false);assert.throws(()=>context.importPlieArchives());
assert.equal(writes,0);assert.equal(requests.length,0);
reset();const token=csrf();assert.equal(call('import-archives',{csrf:'wrong'}).ok,false);assert.equal(writes,0);
lockAvailable=false;assert.equal(call('import-archives',{csrf:token}).ok,false);assert.equal(writes,0);lockAvailable=true;
const kept=clone(state.posts);
let result=call('import-archives',{csrf:token});assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.value.imported,keys);assert.deepEqual(result.value.migratedArchives,keys);assert.equal(state.publication.phase,'building');
assert.deepEqual(state.posts[priorId],kept[priorId]);assert.deepEqual(state.posts[draftId],kept[draftId]);assert.equal(Object.keys(state.posts).length,4);assert.equal(Object.keys(state.media).length,44);
for(const album of catalog.albums){const row=state.posts[album.id];assert.equal(row.legacyKey,album.key);assert.equal(row.draft.displayMode,'gallery');assert.equal(row.draft.eventDate,album.eventDate||'');assert.equal(row.published.eventDate,album.eventDate||'');assert.equal(row.published.blocks.filter(b=>b.type==='image').length,album.key==='kyunghee-cup'?30:14);assert.equal(row.published.publishedAt,row.updated);}
assert.equal(requests.filter(r=>r.url==='/git/blobs'&&r.body.encoding==='base64').length,0,'Already public photos must not be duplicated');
let feed=JSON.parse(requests.filter(r=>r.url==='/git/blobs').map(r=>r.body.content).find(s=>s.startsWith('{"posts":')));
assert.equal(feed.posts.length,3);assert.deepEqual(feed.migratedArchives,keys);assert.equal(feed.posts.find(p=>p.id===priorId).title,'Already published');
const albumFeed=feed.posts.find(p=>p.legacyKey==='kyunghee-cup');assert.equal(albumFeed.displayMode,'gallery');assert.ok(albumFeed.media[albumFeed.coverId].url.startsWith('/assets/events/kyunghee-cup/'));
const fallback=catalog.albums[1].blocks.filter(b=>b.type==='image')[8];assert.equal(state.media[fallback.mediaId].sourcePath,'assets/events/recital-2026/thumbs/recital-2026-09.jpg');
const importedSnapshot=clone(state.posts);requests=[];result=call('import-archives',{csrf:token});assert.equal(result.ok,true);assert.deepEqual(result.value.imported,[]);assert.deepEqual(state.posts,importedSnapshot);assert.equal(requests.filter(r=>r.url.includes('/contents/')).length,0);
const first=catalog.albums[0],saved=call('save',{id:first.id,revision:1,csrf:token,post:{...clone(state.posts[first.id].draft),displayMode:'story',legacyKey:'spoofed'}});assert.equal(saved.ok,true);assert.equal(saved.value.hasChanges,true);assert.equal(state.posts[first.id].legacyKey,first.key);
result=call('delete',{id:first.id,revision:2,csrf:token});assert.equal(result.ok,true);assert.ok(!state.posts[first.id]);
const second=catalog.albums[1];result=call('unpublish',{id:second.id,revision:1,csrf:token});assert.equal(result.ok,true);assert.equal(state.posts[second.id].published,null);
result=call('import-archives',{csrf:token});assert.equal(result.ok,true);assert.deepEqual(result.value.imported,[]);assert.ok(!state.posts[first.id]);assert.equal(state.posts[second.id].published,null);assert.deepEqual(result.value.migratedArchives,keys);
feed=JSON.parse(requests.filter(r=>r.url==='/git/blobs').map(r=>r.body.content).filter(s=>s.startsWith('{"posts":')).at(-1));assert.deepEqual(feed.migratedArchives,keys);assert.equal(feed.posts.length,1);

// Every malformed migration is rejected before any state write.
for(const corrupt of [
 c=>c.albums[0].id='d'.repeat(32),
 c=>c.albums[0].key='unrecognized',
 c=>c.albums[0].blocks.pop(),
 c=>c.albums[0].eventDate='2026-02-30',
 c=>{const id=Object.keys(c.albums[1].media)[0];c.albums[1].media[id].sourcePath='https://evil.example/photo.jpg';},
 c=>{const id=Object.keys(c.albums[1].media)[0];c.albums[1].media[id].thumbnailPath='assets/events/recital-2026/../../private.jpg';},
 c=>{const id=Object.keys(c.albums[1].media)[0];c.albums[1].media[id].id='d'.repeat(32);}
]){reset();corrupt(remoteCatalog);const before=clone(state),t=csrf();assert.equal(call('import-archives',{csrf:t}).ok,false);assert.equal(writes,0);assert.deepEqual(state,before);}
reset();state.posts[first.id]=clone(state.posts[priorId]);let before=clone(state);assert.equal(call('import-archives',{csrf:csrf()}).ok,false);assert.equal(writes,0);assert.deepEqual(state,before);

reset();assert.equal(context.cmsValidate_(state,priorDraft,true).displayMode,'story');assert.throws(()=>context.cmsValidate_(state,{...priorDraft,displayMode:'script'},true));assert.equal(context.cmsPost_(state,draftId,true).displayMode,'story');
const a='1'.repeat(32),b='2'.repeat(32),c='3'.repeat(32),media={[a]:{url:'/a.jpg',thumbnail:'/a-thumb.jpg'},[b]:{url:'/b.jpg'},[c]:{url:'/c.jpg'}};
const article={...clone(priorDraft),displayMode:'gallery',url:'/news/'+priorId+'.html',publishedAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z',media,coverId:a,blocks:[{type:'text',text:'Before'},{type:'image',mediaId:a,alt:'<unsafe "label">',caption:'<script>bad</script>'},{type:'image',mediaId:b},{type:'heading',text:'Between'},{type:'image',mediaId:c},{type:'text',text:'After'}]};
const html=context.cmsArticle_(article);assert.equal((html.match(/class="article-gallery"/g)||[]).length,2);assert.equal((html.match(/data-image-open=/g)||[]).length,3);assert.ok(html.includes('src="/a-thumb.jpg"'));assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(html.includes('&lt;unsafe &quot;label&quot;&gt;'));
assert.ok(html.indexOf('Before')<html.indexOf('data-image-open="/a.jpg"'));assert.ok(html.indexOf('data-image-open="/b.jpg"')<html.indexOf('Between'));assert.ok(html.indexOf('Between')<html.indexOf('data-image-open="/c.jpg"'));assert.ok(html.indexOf('data-image-open="/c.jpg"')<html.indexOf('After'));
assert.ok(!context.cmsArticle_({...article,displayMode:'story'}).includes('class="article-gallery"'));
reset();remoteCatalog.albums[0].eventDate='2024-02-29';delete remoteCatalog.albums[1].eventDate;
result=call('import-archives',{csrf:csrf()});assert.equal(result.ok,true);
assert.equal(state.posts[first.id].draft.eventDate,'2024-02-29');assert.equal(state.posts[first.id].published.eventDate,'2024-02-29');
assert.equal(state.posts[second.id].draft.eventDate,'');assert.equal(state.posts[second.id].published.eventDate,'');
assert.notEqual(state.posts[first.id].published.publishedAt,'2024-02-29','Import time remains publication metadata, not the event date');
console.log('PASS: real 44-photo catalog, owner/CSRF/lock gates, existing draft/published preservation, source reuse, default modes, gallery order/escaping, invalid input atomicity, idempotency and deletion/unpublish tombstones. No external writes.');
