const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=__dirname,owner='plie0312@gmail.com';
let active=owner,effective=owner,state,requests=[],writes=0,locked=false;
const props=new Map([['CMS_GITHUB_TOKEN','test-token-not-real'],['CMS_INSTANCE_ID','a'.repeat(32)]]),cache=new Map();
const cacheApi={get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)};
const context=vm.createContext({console,Session:{getActiveUser:()=>({getEmail:()=>active}),getEffectiveUser:()=>({getEmail:()=>effective})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),setProperties:o=>Object.entries(o).forEach(([k,v])=>props.set(k,v))})},
  CacheService:{getUserCache:()=>cacheApi,getScriptCache:()=>cacheApi},
  LockService:{getScriptLock:()=>({tryLock:()=>!locked,waitLock:()=>{},releaseLock:()=>{}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>[...Buffer.from(s,'base64')],newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')}),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'}},
  HtmlService:{createHtmlOutputFromFile:name=>({getContent:()=>fs.readFileSync(path.join(root,name+'.html'),'utf8')}),createHtmlOutput:s=>({getContent:()=>s,setTitle(){return this;},addMetaTag(){return this;}})},
  UrlFetchApp:{fetch:()=>{throw Error('No external network in tests');}}
});
const source=fs.readFileSync(path.join(root,'Code.gs'),'utf8');new vm.Script(source);vm.runInContext(source,context);
const call=(action,payload={})=>JSON.parse(JSON.stringify(context.cmsRequest(action,payload)));
context.cmsState_=()=>structuredClone(state);context.cmsWrite_=value=>{state=structuredClone(value);writes++;};
context.cmsDataImage_=()=> 'data:image/jpeg;base64,/9j/2Q==';
function reset(){active=owner;effective=owner;state={posts:{},media:{},publication:{phase:'ready',message:'Ready'}};requests=[];writes=0;cache.clear();}
reset();
for(const identity of ['', 'another@example.com'])for(const action of ['session','posts','post','upload','save','publish','delete','site-sync','site-status']){
  active=identity;const result=call(action,{email:owner,actor:{email:owner}});assert.equal(result.ok,false,action);assert.equal(writes,0);
}
active=owner;effective='another@example.com';assert.equal(call('session').ok,false);assert.throws(()=>context.setupPlieCms());
reset();const session=call('session').value;assert.equal(session.username,owner);assert.equal(session.google,true);
assert.equal(call('save',{csrf:'wrong'}).ok,false);assert.equal(writes,0);
assert.equal(call('cmsGithub_',{csrf:session.csrf}).ok,false);
const id='b'.repeat(32),post={title:'플리에 <script>소식</script>',blocks:[{type:'text',text:'Private draft {{BODY}} <img onerror="x">'}]};
let saved=call('save',{id,revision:0,post,csrf:session.csrf});assert.equal(saved.ok,true);assert.equal(state.posts[id].published,null);assert.equal(requests.length,0);
assert.equal(call('save',{id,revision:0,post,csrf:session.csrf}).ok,false);
// Simulate the GitHub object API without a token or real repository mutation.
const manifest={files:['content/posts.json','content/release.json'],ownerId:'legacy-empty-cms',version:1};
const staticBlobs={manifest:JSON.stringify(manifest),sitemap:'<urlset><url><loc>https://www.plierg.com/about.html</loc></url></urlset>'};
context.cmsGithub_=(url,method,body)=>{
  requests.push({url,method,body});
  if(url==='/git/ref/heads/main')return {object:{sha:'base'}};
  if(url==='/git/commits/base')return {tree:{sha:'base-tree'}};
  if(url.startsWith('/git/trees/base-tree'))return {tree:[{path:'content/cms-manifest.json',sha:'manifest',type:'blob',size:20},{path:'sitemap.xml',sha:'sitemap',type:'blob',size:100}]};
  if(url.startsWith('/git/blobs/'))return {content:Buffer.from(staticBlobs[url.split('/').pop()]).toString('base64')};
  if(url==='/git/blobs')return {sha:crypto.createHash('sha1').update(body.content).digest('hex')};
  if(url==='/git/trees')return {sha:'next-tree'};
  if(url==='/git/commits')return {sha:'next-commit'};
  if(url==='/git/refs/heads/main'){assert.equal(body.force,false);return {};}
  throw Error('Unexpected API '+url);
};
let published=call('publish',{id,revision:1,post,csrf:session.csrf});assert.equal(published.ok,true);assert.equal(state.publication.phase,'building');
const html=requests.find(r=>r.url==='/git/blobs'&&r.body.content.includes('<!doctype')).body.content;
assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img onerror='));assert.ok(!html.includes('test-token-not-real'));
assert.equal(JSON.stringify(requests.find(r=>r.url==='/git/commits').body.parents),JSON.stringify(['base']));
requests=[];post.title='UNPUBLISHED EDIT';saved=call('save',{id,revision:2,post,csrf:session.csrf});assert.equal(saved.ok,true);assert.equal(requests.length,0);assert.notEqual(state.posts[id].published.title,post.title);
const oldSync=context.cmsGithub_;context.cmsGithub_=()=>{throw Error('sensitive token in upstream error');};
published=call('publish',{id,revision:3,post,csrf:session.csrf});assert.equal(published.ok,true);assert.equal(state.publication.phase,'error');assert.ok(!state.publication.message.includes('sensitive token'));
context.cmsGithub_=oldSync;
manifest.files=['news/'+id+'.html'];staticBlobs.manifest=JSON.stringify(manifest);assert.throws(()=>context.cmsSync_(structuredClone(state)),/기존 관리자/);
manifest.files=['cms-app/data/cms.sqlite3'];staticBlobs.manifest=JSON.stringify(manifest);assert.throws(()=>context.cmsSync_(structuredClone(state)),/목록/);
assert.equal(context.cmsYoutube_('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'dQw4w9WgXcQ');assert.equal(context.cmsYoutube_('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'),null);
assert.equal(call('logout',{csrf:session.csrf}).ok,true);assert.equal(call('delete',{id,revision:4,csrf:session.csrf}).ok,false);
const admin=fs.readFileSync(path.join(root,'Admin.html'),'utf8'),scripts=[...admin.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];assert.equal(scripts.length,2);scripts.forEach(s=>new vm.Script(s[1]));assert.ok(!admin.includes('CMS_GITHUB_TOKEN'));assert.ok(!admin.includes('<?= '));
console.log('PASS: exact active/effective Google identity, every RPC guarded, CSRF, revisions, drafts, safe HTML, public-only Git tree, no force push, conflict/failure handling, raw Admin script syntax. No external writes.');
