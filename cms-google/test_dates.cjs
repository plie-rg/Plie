const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=__dirname,owner='plie0312@gmail.com',clone=value=>JSON.parse(JSON.stringify(value));
let state,writes=0,requests=[];
const cache=new Map(),cacheApi={get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)};
const props=new Map([['CMS_GITHUB_TOKEN','test-placeholder'],['CMS_INSTANCE_ID','f'.repeat(32)]]);
const context=vm.createContext({console,
 Session:{getActiveUser:()=>({getEmail:()=>owner}),getEffectiveUser:()=>({getEmail:()=>owner})},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null})},
 CacheService:{getUserCache:()=>cacheApi,getScriptCache:()=>cacheApi},
 LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock:()=>{},releaseLock:()=>{}})},
 Utilities:{getUuid:()=>crypto.randomUUID(),base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>[...Buffer.from(s,'base64')],newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')}),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'}},
 HtmlService:{createHtmlOutputFromFile:name=>({getContent:()=>fs.readFileSync(path.join(root,name+'.html'),'utf8')})},
 UrlFetchApp:{fetch:()=>{throw Error('External network is disabled');}}
});
vm.runInContext(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),context);
const readStoredState=context.cmsState_;
context.cmsState_=()=>clone(state);context.cmsWrite_=value=>{state=clone(value);writes++;};
context.cmsGithub_=(url,method,body)=>{
 requests.push({url,method,body});
 if(url==='/git/ref/heads/main')return {object:{sha:'base'}};
 if(url==='/git/commits/base')return {tree:{sha:'base-tree'}};
 if(url.startsWith('/git/trees/base-tree'))return {tree:[{path:'content/cms-manifest.json',sha:'manifest',type:'blob',size:1},{path:'sitemap.xml',sha:'sitemap',type:'blob',size:1}]};
 if(url==='/git/blobs/manifest')return {content:Buffer.from(JSON.stringify({version:1,ownerId:props.get('CMS_INSTANCE_ID'),files:['content/posts.json','content/release.json']})).toString('base64')};
 if(url==='/git/blobs/sitemap')return {content:Buffer.from('<urlset></urlset>').toString('base64')};
 if(url==='/git/blobs')return {sha:crypto.createHash('sha1').update(body.content).digest('hex')};
 if(url==='/git/trees')return {sha:'next-tree'};
 if(url==='/git/commits')return {sha:'next-commit'};
 if(url==='/git/refs/heads/main'){assert.equal(body.force,false);return {};}
 throw Error('Unexpected API '+url);
};
function reset(){state={posts:{},media:{},publication:{phase:'ready'}};writes=0;requests=[];cache.clear();}
const call=(action,payload={})=>clone(context.cmsRequest(action,payload));
const draft={title:'Event <script>title</script>',excerpt:'Keep publication date',category:'competition',branch:'all',displayMode:'story',coverId:'',blocks:[{type:'text',text:'<unsafe> event details'}]};
const ids=Object.fromEntries('abcdefg'.split('').map(letter=>[letter,letter.repeat(32)]));
function row(letter,eventDate,publishedAt){
 const post={...clone(draft),eventDate};
 return {id:ids[letter],draft:clone(post),published:{...clone(post),publishedAt,updatedAt:publishedAt},revision:1,updated:publishedAt};
}
function publicFeed(){requests=[];context.cmsSync_(clone(state));return JSON.parse(requests.filter(r=>r.url==='/git/blobs').map(r=>r.body.content).find(s=>s.startsWith('{"posts":')));}
function publicIds(){return publicFeed().posts.map(p=>p.id);}

// Dates are calendar days, never JavaScript's permissive rollover parsing.
reset();
for(const date of ['1000-01-01','2000-02-29','2024-02-29','2026-04-30','9999-12-31'])assert.equal(context.cmsValidate_(state,{...draft,eventDate:date},true).eventDate,date);
for(const date of ['0999-01-01','10000-01-01','1900-02-29','2100-02-29','2026-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','2026-1-01','2026-01-1','2026-01-01T00:00:00Z',' 2026-01-01','2026-01-01 ','<img onerror=x>',0,false,{},[]])assert.throws(()=>context.cmsValidate_(state,{...draft,eventDate:date},true),undefined,String(date));
for(const date of [undefined,null,''])assert.equal(context.cmsValidate_(state,{...draft,eventDate:date},true).eventDate,'');
let csrf=call('session').value.csrf;
const before=clone(state);assert.equal(call('save',{id:ids.a,revision:0,post:{...draft,eventDate:'2026-02-30'},csrf}).ok,false);assert.equal(writes,0);assert.deepEqual(state,before);

// An old post with no event date stays undated; an empty date is not an edit.
state.posts[ids.a]=row('a','', '2026-10-29T00:00:00.000Z');delete state.posts[ids.a].draft.eventDate;delete state.posts[ids.a].published.eventDate;
let detail=call('post',{id:ids.a}).value;
assert.equal(detail.eventDate,'');assert.equal(detail.hasChanges,false);assert.equal(detail.publishedAt,'2026-10-29T00:00:00.000Z');
state.posts[ids.a].draft.eventDate='';assert.equal(call('post',{id:ids.a}).value.hasChanges,false);
state.posts[ids.a].draft.eventDate='2026-01-02';assert.equal(call('post',{id:ids.a}).value.hasChanges,true);

// Known event dates precede undated posts even when imported/published much later.
reset();csrf=call('session').value.csrf;
state.posts={
 [ids.e]:row('e','', '2029-12-31T00:00:00.000Z'),
 [ids.d]:row('d','2026-07-01','2026-07-31T00:00:00.000Z'),
 [ids.a]:row('a','2026-06-20','2026-09-10T00:00:00.000Z'),
 [ids.c]:row('c','2026-07-01','2026-08-01T00:00:00.000Z'),
 [ids.f]:row('f','2025-03-01','2025-03-01T00:00:00.000Z'),
 [ids.b]:row('b','2026-07-01','2026-08-01T00:00:00.000Z'),
 [ids.g]:{id:ids.g,draft:{...clone(draft),eventDate:'2028-01-01'},published:null,revision:1,updated:'2030-01-01T00:00:00.000Z'}
};
const originalOrder=['b','c','d','a','f','e'].map(k=>ids[k]);
assert.deepEqual(publicIds(),originalOrder);
state.posts[ids.a].updated='9999-12-31T00:00:00.000Z';assert.deepEqual(publicIds(),originalOrder,'Updated timestamps must not reorder public posts');
let result=call('save',{id:ids.a,revision:1,post:{...draft,eventDate:'2027-01-01'},csrf});
assert.equal(result.ok,true);assert.equal(result.value.hasChanges,true);assert.equal(state.posts[ids.a].draft.eventDate,'2027-01-01');assert.equal(state.posts[ids.a].published.eventDate,'2026-06-20');
assert.deepEqual(publicIds(),originalOrder,'An unpublished event date must never reorder the public feed');
assert.deepEqual(call('posts').value.posts.map(p=>p.id),['g','a','b','c','d','f','e'].map(k=>ids[k]));
const firstPublished=state.posts[ids.a].published.publishedAt;
result=call('publish',{id:ids.a,revision:2,post:{...draft,eventDate:'2027-01-01'},csrf});
assert.equal(result.ok,true);assert.equal(result.value.hasChanges,false);assert.equal(state.posts[ids.a].published.eventDate,'2027-01-01');assert.equal(state.posts[ids.a].published.publishedAt,firstPublished);
assert.deepEqual(publicIds(),['a','b','c','d','f','e'].map(k=>ids[k]));
result=call('publish',{id:ids.a,revision:3,post:{...draft,title:'Changed wording only',eventDate:'2027-01-01'},csrf});assert.equal(result.ok,true);
assert.deepEqual(publicIds(),['a','b','c','d','f','e'].map(k=>ids[k]),'Republishing text must keep event ordering');
result=call('publish',{id:ids.a,revision:4,post:{...draft,eventDate:''},csrf});assert.equal(result.ok,true);
assert.deepEqual(publicIds(),['b','c','d','f','e','a'].map(k=>ids[k]),'Clearing date moves the record into the undated group');

// Event display is independent of publication metadata used by search engines.
const article={...clone(draft),eventDate:'2024-02-29',url:'/news/'+ids.a+'.html',publishedAt:'2026-10-29T01:00:00.000Z',updatedAt:'2026-10-30T02:00:00.000Z',media:{}};
const html=context.cmsArticle_(article);
assert.ok(html.includes('2024.02.29'));assert.ok(html.includes('&lt;script&gt;title&lt;/script&gt;'));assert.ok(html.includes('&lt;unsafe&gt;'));
const metadata=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.equal(metadata.datePublished,article.publishedAt);assert.equal(metadata.dateModified,article.updatedAt);
assert.ok(context.cmsArticle_({...article,eventDate:''}).includes('행사 날짜 미입력'));
assert.ok(context.cmsArticle_({...article,eventDate:undefined}).includes('행사 날짜 미입력'));
assert.throws(()=>context.cmsArticle_({...article,eventDate:'<img onerror=x>'}));

// Compatibility for an album imported before eventDate existed, without writes
// or changing an owner's chosen/cleared date or unrelated posts.
reset();
const archiveId='1e98e803d01fa54a07c0bfb1d9b056a7';
let stored={posts:{[archiveId]:{id:archiveId,legacyKey:'kyunghee-cup',draft:clone(draft),published:{...clone(draft),publishedAt:'2026-10-29T00:00:00.000Z'}}},media:{}};
context.cmsFile_=()=>({getBlob:()=>({getDataAsString:()=>JSON.stringify(stored)})});
let normalized=readStoredState();
assert.equal(normalized.posts[archiveId].draft.eventDate,'2025-09-06');assert.equal(normalized.posts[archiveId].published.eventDate,'2025-09-06');
assert.ok(!Object.hasOwn(stored.posts[archiveId].draft,'eventDate'));assert.equal(writes,0);
stored.posts[archiveId].draft.eventDate='';stored.posts[archiveId].published.eventDate='2025-09-07';normalized=readStoredState();
assert.equal(normalized.posts[archiveId].draft.eventDate,'');assert.equal(normalized.posts[archiveId].published.eventDate,'2025-09-07');
delete stored.posts[archiveId].draft.eventDate;delete stored.posts[archiveId].published.eventDate;
stored.posts[archiveId].legacyKey='recital-2026';normalized=readStoredState();assert.ok(!Object.hasOwn(normalized.posts[archiveId].draft,'eventDate'));
stored.posts[archiveId].legacyKey='kyunghee-cup';stored.posts[archiveId].id=ids.a;normalized=readStoredState();assert.ok(!Object.hasOwn(normalized.posts[archiveId].draft,'eventDate'));
assert.equal(writes,0);
console.log('PASS: valid Gregorian event dates, invalid-input atomicity, legacy empty defaults, stable event chronology, draft/public separation, original publication timestamps, safe date rendering. No external writes.');
