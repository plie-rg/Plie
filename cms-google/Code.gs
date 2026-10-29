/* Standalone project: do not replace the rental project's Code.gs. */
const CMS_OWNER = 'plie0312@gmail.com';
const CMS_SITE = 'https://www.plierg.com';
const CMS_REPO = 'https://api.github.com/repos/plie-rg/Plie';
const CMS_MAX_VIDEO = 25 * 1024 * 1024;
const CMS_ARCHIVES = {
  'kyunghee-cup': {id:'1e98e803d01fa54a07c0bfb1d9b056a7',count:30,category:'competition'},
  'recital-2026': {id:'afa6bc71c9593fcb1fe474aacea4580f',count:14,category:'event'}
};

function cmsFail_(message) { const error = new Error(message); error.cmsSafe = true; throw error; }
function cmsOwner_() {
  // Effective user alone is NOT proof of the caller's identity.
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (active !== CMS_OWNER || effective !== CMS_OWNER) cmsFail_('플리에 운영 구글 계정으로만 접속할 수 있습니다.');
}
function cmsProps_() { return PropertiesService.getScriptProperties(); }
function cmsId_(value) { if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) cmsFail_('항목을 찾을 수 없습니다.'); return value; }
function cmsText_(value, max, required) { if (typeof value !== 'string' || value.length > max || required && !value.trim()) cmsFail_('입력 내용과 글자 수를 확인해 주세요.'); return value.trim(); }
function cmsUuid_() { return Utilities.getUuid().replace(/-/g, ''); }
function cmsEscape_(value) { return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cmsPrivate_(file) {
  if (!file.getOwner() || file.getOwner().getEmail().toLowerCase() !== CMS_OWNER || file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length) cmsFail_('CMS 저장소는 플리에 계정의 비공개 파일이어야 합니다.');
  return file;
}
function cmsFolder_() { const id = cmsProps_().getProperty('CMS_FOLDER_ID'); if (!id) cmsFail_('Apps Script에서 setupPlieCms를 한 번 실행해 주세요.'); return cmsPrivate_(DriveApp.getFolderById(id)); }
function cmsFile_(id) {
  const file = cmsPrivate_(DriveApp.getFileById(id));
  const parents = file.getParents();
  if (!parents.hasNext() || parents.next().getId() !== cmsFolder_().getId() || parents.hasNext()) cmsFail_('CMS 전용 파일이 아닙니다.');
  return file;
}
function cmsState_() { return JSON.parse(cmsFile_(cmsProps_().getProperty('CMS_STATE_ID')).getBlob().getDataAsString('UTF-8')); }
function cmsWrite_(state) { cmsFile_(cmsProps_().getProperty('CMS_STATE_ID')).setContent(JSON.stringify(state)); }

function setupPlieCms() {
  cmsOwner_();
  const lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    const props = cmsProps_();
    if (props.getProperty('CMS_STATE_ID')) { cmsState_(); return '이미 설정되어 있습니다. 기존 내용은 유지했습니다.'; }
    const folder = props.getProperty('CMS_FOLDER_ID') ? cmsFolder_() : DriveApp.createFolder('플리에 홈페이지 게시물 · 비공개');
    props.setProperty('CMS_FOLDER_ID', folder.getId());
    const state = folder.createFile('cms-state.json', JSON.stringify({posts:{},media:{},publication:{phase:'ready',message:'게시할 글을 작성해 주세요.'}}), MimeType.PLAIN_TEXT);
    props.setProperties({CMS_STATE_ID:state.getId(), CMS_INSTANCE_ID:cmsUuid_()});
    return '비공개 저장소를 만들었습니다. GitHub 연결과 나만 접근 웹 앱 배포를 완료해 주세요.';
  } finally { lock.releaseLock(); }
}

function doGet() {
  try {
    cmsOwner_();
    // Raw HTML avoids HtmlTemplate comment/template rewriting of bundled scripts.
    return HtmlService.createHtmlOutput(HtmlService.createHtmlOutputFromFile('Admin').getContent())
      .setTitle('플리에 · 게시물 관리').addMetaTag('viewport','width=device-width,initial-scale=1');
  } catch (error) {
    return HtmlService.createHtmlOutput('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:560px;margin:80px auto;font-family:sans-serif;padding:24px"><h1>플리에 관리자 전용</h1><p>'+cmsEscape_(error.cmsSafe ? error.message : '관리 화면을 열지 못했습니다. 구글 배포 설정을 확인해 주세요.')+'</p><a href="https://www.plierg.com" target="_top">홈페이지로 돌아가기</a></main>');
  }
}

function cmsRequest(action, payload) {
  let lock;
  try {
    cmsOwner_();
    const allowed = ['session','posts','post','media','upload','save','publish','unpublish','delete','site-status','site-sync','import-archives','logout'];
    if (!allowed.includes(action)) cmsFail_('지원하지 않는 요청입니다.');
    payload = payload || {};
    const cache = CacheService.getUserCache();
    if (action === 'session') {
      let csrf = cache.get('cms-csrf'); if (!csrf) { csrf = cmsUuid_()+cmsUuid_(); cache.put('cms-csrf',csrf,21600); }
      return {ok:true,value:{app:'plie-google-cms',configured:true,authenticated:true,username:CMS_OWNER,csrf,local:false,publishing:true,google:true,archiveImport:true}};
    }
    const reads = ['posts','post','media','site-status'];
    if (!reads.includes(action) && (!cache.get('cms-csrf') || payload.csrf !== cache.get('cms-csrf'))) cmsFail_('관리 화면을 새로고침한 뒤 다시 시도해 주세요.');
    if (action === 'logout') { cache.remove('cms-csrf'); return {ok:true,value:{ok:true}}; }
    if (!reads.includes(action)) { lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) cmsFail_('다른 저장 작업이 진행 중입니다. 잠시 뒤 다시 시도해 주세요.'); }
    const state = cmsState_(); let value;
    if (action === 'posts') value = {posts:Object.values(state.posts).sort((a,b)=>b.updated.localeCompare(a.updated)).map(p=>cmsPost_(state,p.id,false)),migratedArchives:cmsArchiveKeys_(state)};
    if (action === 'post') value = cmsPost_(state,cmsId_(payload.id),true);
    if (action === 'media') value = cmsMedia_(state,cmsId_(payload.id),true);
    if (action === 'site-status') value = cmsStatus_(state);
    if (action === 'upload') { value = cmsUpload_(state,payload); cmsWrite_(state); }
    if (action === 'save' || action === 'publish') {
      const id = cmsId_(payload.id), current = state.posts[id];
      if (current && current.revision !== payload.revision || !current && payload.revision) cmsFail_('다른 창에서 수정됐습니다. 목록을 다시 열어 주세요.');
      if (!current && Object.keys(state.posts).length >= 500) cmsFail_('게시물은 500개까지 관리할 수 있습니다.');
      const post = cmsValidate_(state,payload.post,action === 'publish'), now = new Date().toISOString();
      state.posts[id] = {id, draft:post, published:current && current.published || null, revision:(current ? current.revision : 0)+1, updated:now};
      if (current && current.legacyKey) state.posts[id].legacyKey = current.legacyKey;
      if (action === 'publish') state.posts[id].published = Object.assign({},post,{publishedAt:current && current.published ? current.published.publishedAt : now,updatedAt:now});
      cmsWrite_(state);
      if (action === 'publish') cmsSyncSafely_(state);
      value = cmsPost_(state,id,true);
    }
    if (action === 'unpublish' || action === 'delete') {
      const id = cmsId_(payload.id), post = state.posts[id];
      if (!post || post.revision !== payload.revision) cmsFail_('다른 창에서 수정됐습니다. 목록을 다시 열어 주세요.');
      if (action === 'delete') delete state.posts[id];
      else { post.published = null; post.revision++; post.updated = new Date().toISOString(); }
      cmsWrite_(state); cmsSyncSafely_(state); value = {ok:true};
    }
    if (action === 'site-sync') { cmsSyncSafely_(state); value = cmsStatus_(state); }
    if (action === 'import-archives') {
      const imported = cmsImportArchives_(state);
      cmsSyncSafely_(state);
      value = {imported,migratedArchives:cmsArchiveKeys_(state),publication:cmsStatus_(state)};
    }
    return {ok:true,value};
  } catch (error) { return {ok:false,error:error.cmsSafe ? error.message : '요청을 처리하지 못했습니다. 저장소와 연결 설정을 확인해 주세요.'}; }
  finally { if (lock) lock.releaseLock(); }
}

function cmsYoutube_(value) {
  const match = /^https:\/\/(?:www\.|m\.)?(?:youtu\.be\/([\w-]{11})(?:[?#].*)?|youtube\.com\/(?:watch\?(?:[^#]*&)?v=([\w-]{11})(?:[&#].*)?|(?:shorts|live|embed)\/([\w-]{11})(?:[?/#].*)?))$/.exec(value);
  return match && (match[1]||match[2]||match[3]);
}
function cmsValidate_(state,input,publish) {
  if (!input || !Array.isArray(input.blocks) || input.blocks.length > 100) cmsFail_('본문 형식을 확인해 주세요.');
  const post = {title:cmsText_(input.title||'',100,publish),excerpt:cmsText_(input.excerpt||'',180),category:input.category||'class',branch:input.branch||'all',displayMode:input.displayMode||'story',coverId:input.coverId||'',blocks:[]};
  if (!['notice','class','event','competition'].includes(post.category) || !['all','magok','gangnam'].includes(post.branch)) cmsFail_('분류와 지점을 확인해 주세요.');
  if (!['story','gallery'].includes(post.displayMode)) cmsFail_('이야기형 또는 사진첩형을 선택해 주세요.');
  const ids = [];
  input.blocks.forEach(block=>{
    if (['text','heading'].includes(block.type)) { const text=cmsText_(block.text||'',10000); if(text) post.blocks.push({type:block.type,text}); }
    else if (['image','video'].includes(block.type)) {
      const id=cmsId_(block.mediaId), media=state.media[id];
      if (!media || media.kind!==block.type) cmsFail_('첨부파일을 확인해 주세요.');
      ids.push(id); post.blocks.push({type:block.type,mediaId:id,caption:cmsText_(block.caption||'',300),alt:cmsText_(block.alt||'',160)});
    } else if (block.type==='youtube') { const id=cmsYoutube_(cmsText_(block.url||'',500)); if(!id) cmsFail_('유튜브 주소를 확인해 주세요.'); post.blocks.push({type:'youtube',videoId:id,url:'https://www.youtube.com/watch?v='+id,caption:cmsText_(block.caption||'',300)}); }
    else cmsFail_('지원하지 않는 본문 형식입니다.');
  });
  if (ids.length>30) cmsFail_('한 게시물에는 사진·영상 30개까지 첨부할 수 있습니다.');
  if (publish && !post.blocks.length) cmsFail_('글이나 사진·영상을 하나 이상 넣어 주세요.');
  if (post.coverId && !ids.includes(post.coverId)) cmsFail_('대표 이미지는 본문의 첨부파일 중 선택해 주세요.');
  post.coverId=post.coverId||ids[0]||'';
  if (!post.excerpt) post.excerpt=(post.blocks.find(b=>b.type==='text')||{text:''}).text.slice(0,140);
  return post;
}
function cmsDataImage_(fileId) { return 'data:image/jpeg;base64,'+Utilities.base64Encode(cmsFile_(fileId).getBlob().getBytes()); }
function cmsMedia_(state,id,detail) {
  const asset=state.media[id]; if(!asset) cmsFail_('첨부파일을 찾을 수 없습니다.');
  if(asset.sourcePath) {
    cmsArchiveAsset_(asset);
    return {id,kind:'image',status:'ready',size:asset.size,error:'',url:CMS_SITE+'/'+(asset.thumbnailPath||asset.sourcePath),originalUrl:CMS_SITE+'/'+asset.sourcePath,poster:'',previewUrl:'',driveUrl:''};
  }
  const thumb=cmsDataImage_(asset.thumbId);
  return {id,kind:asset.kind,status:'ready',size:asset.size,error:'',url:asset.kind==='image'?thumb:'',poster:asset.kind==='video'?thumb:'',previewUrl:asset.kind==='video'?'https://drive.google.com/file/d/'+asset.fileId+'/preview':'',driveUrl:asset.kind==='video'?'https://drive.google.com/file/d/'+asset.fileId+'/view':''};
}
function cmsPost_(state,id,detail) {
  const row=state.posts[id]; if(!row) cmsFail_('게시물을 찾을 수 없습니다.');
  const value=JSON.parse(JSON.stringify(row.draft)), ids=detail ? value.blocks.filter(b=>b.mediaId).map(b=>b.mediaId) : [value.coverId];
  value.displayMode=value.displayMode||'story';
  value.media={}; [...new Set(ids)].filter(Boolean).forEach(mid=>value.media[mid]=cmsMedia_(state,mid,detail));
  return Object.assign(value,{id,revision:row.revision,updated:row.updated,status:row.published?'published':'draft',hasChanges:!!row.published&&(['title','excerpt','category','branch','coverId','blocks'].some(k=>JSON.stringify(row.draft[k])!==JSON.stringify(row.published[k]))||(row.draft.displayMode||'story')!==(row.published.displayMode||'story')),url:'/news/'+id+'.html',legacyKey:row.legacyKey||''});
}

function cmsArchiveKeys_(state) {
  return Object.keys(CMS_ARCHIVES).filter(key=>state.importedArchives && state.importedArchives[key] && state.importedArchives[key].id===CMS_ARCHIVES[key].id);
}
function cmsArchiveAsset_(asset) {
  const match=asset && /^assets\/events\/(kyunghee-cup|recital-2026)\/(thumbs\/)?\1-(\d{2})\.jpg$/.exec(asset.sourcePath||'');
  if(!match) cmsFail_('기존 사진첩의 사진 경로가 올바르지 않습니다.');
  const key=match[1], number=Number(match[3]), definition=CMS_ARCHIVES[key];
  const expectedThumb='assets/events/'+key+'/thumbs/'+key+'-'+match[3]+'.jpg';
  const expectedId=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,'plie:archive-media:'+asset.sourcePath).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('').slice(0,32);
  if(asset.kind!=='image'||asset.id!==expectedId||number<1||number>definition.count||asset.thumbnailPath!==expectedThumb||match[2]&&!(key==='recital-2026'&&number===9)||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>CMS_MAX_VIDEO) cmsFail_('기존 사진첩의 사진 정보를 확인해 주세요.');
  return {key,number};
}
function cmsArchiveCatalog_() {
  const file=cmsGithub_('/contents/content/legacy-albums.json?ref=main');
  if(file.encoding!=='base64'||typeof file.content!=='string'||file.content.length>500000) cmsFail_('기존 사진첩 가져오기 파일을 확인해 주세요.');
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(file.content.replace(/\s/g,''))).getDataAsString('UTF-8'));
}
function cmsImportArchives_(state) {
  const done= cmsArchiveKeys_(state);
  if(done.length===Object.keys(CMS_ARCHIVES).length) return [];
  const catalog=cmsArchiveCatalog_();
  if(!catalog||catalog.version!==1||!Array.isArray(catalog.albums)||catalog.albums.length!==2) cmsFail_('기존 사진첩 목록 형식이 올바르지 않습니다.');
  const next=JSON.parse(JSON.stringify(state)), seen=[], imported=[], now=new Date().toISOString();
  next.importedArchives=next.importedArchives||{};
  catalog.albums.forEach(album=>{
    const definition=album&&CMS_ARCHIVES[album.key];
    if(!definition||seen.includes(album.key)||album.id!==definition.id||album.legacyUrl!=='/'+album.key+'.html'||album.category!==definition.category||album.branch!=='all'||album.displayMode!=='gallery'||!album.media||Array.isArray(album.media)) cmsFail_('허용된 기존 사진첩만 가져올 수 있습니다.');
    seen.push(album.key);
    const mediaIds=Object.keys(album.media), numbers=[];
    if(mediaIds.length!==definition.count||!Array.isArray(album.blocks)||album.blocks.some(block=>!block||!['text','heading','image'].includes(block.type))) cmsFail_('기존 사진첩의 사진 수와 본문을 확인해 주세요.');
    mediaIds.forEach(id=>{
      const asset=album.media[id], checked=cmsArchiveAsset_(asset);
      if(id!==asset.id||checked.key!==album.key||numbers.includes(checked.number)) cmsFail_('기존 사진첩의 사진 목록이 중복되거나 올바르지 않습니다.');
      numbers.push(checked.number);
    });
    const referenced=album.blocks.filter(b=>b.type==='image').map(b=>b.mediaId);
    if(referenced.length!==definition.count||new Set(referenced).size!==definition.count||referenced.some(id=>!mediaIds.includes(id))) cmsFail_('기존 사진첩의 사진이 빠져 있습니다.');
    // Validate every album before the single state write, including already imported ones.
    const candidate={media:Object.assign({},next.media,album.media)};
    const post=cmsValidate_(candidate,album,true);
    if(done.includes(album.key)) return;
    if(next.posts[album.id]||next.importedArchives[album.key]) cmsFail_('같은 사진첩의 기존 데이터가 있습니다. 덮어쓰지 않았습니다.');
    mediaIds.forEach(id=>{if(next.media[id]) cmsFail_('같은 사진 파일 정보가 이미 있습니다. 덮어쓰지 않았습니다.');});
    mediaIds.forEach(id=>{
      const asset=album.media[id];
      next.media[id]={id,kind:'image',sourcePath:asset.sourcePath,thumbnailPath:asset.thumbnailPath,size:asset.size};
    });
    next.posts[album.id]={id:album.id,draft:post,published:Object.assign({},post,{publishedAt:now,updatedAt:now}),revision:1,updated:now,legacyKey:album.key};
    next.importedArchives[album.key]={id:album.id,importedAt:now};
    imported.push(album.key);
  });
  if(Object.keys(next.posts).length>500) cmsFail_('게시물은 500개까지 관리할 수 있습니다.');
  // A durable marker remains after unpublishing/deleting, so reruns never resurrect a post.
  if(imported.length) {
    state.posts=next.posts;state.media=next.media;state.importedArchives=next.importedArchives;
    cmsWrite_(state);
  }
  return imported;
}
function importPlieArchives() {
  cmsOwner_();
  const lock=LockService.getScriptLock();lock.waitLock(5000);
  try {
    const state=cmsState_(), imported=cmsImportArchives_(state);
    cmsSyncSafely_(state);
    return {imported,migratedArchives:cmsArchiveKeys_(state),publication:cmsStatus_(state)};
  } finally {lock.releaseLock();}
}

function cmsUpload_(state,payload) {
  if (!['image','video'].includes(payload.kind) || typeof payload.base64!=='string' || payload.base64.length>Math.ceil(CMS_MAX_VIDEO/3)*4) cmsFail_('파일은 25MB 이하의 사진 또는 MP4 영상이어야 합니다.');
  const bytes=Utilities.base64Decode(payload.base64), video=payload.kind==='video';
  if (!bytes.length || bytes.length>(video?CMS_MAX_VIDEO:3*1024*1024)) cmsFail_('파일 용량을 줄여 주세요.');
  if (video ? String.fromCharCode(...bytes.slice(4,8))!=='ftyp' : (bytes[0]&255)!==255||(bytes[1]&255)!==216) cmsFail_('사진은 JPEG, 영상은 MP4 파일을 사용해 주세요.');
  if (typeof payload.thumbnail!=='string' || payload.thumbnail.length>350000) cmsFail_('대표 이미지 용량을 확인해 주세요.');
  const thumbnail=Utilities.base64Decode(payload.thumbnail);
  if ((thumbnail[0]&255)!==255 || (thumbnail[1]&255)!==216) cmsFail_('대표 이미지 형식이 올바르지 않습니다.');
  const id=cmsUuid_(), folder=cmsFolder_(), file=folder.createFile(Utilities.newBlob(bytes,video?'video/mp4':'image/jpeg',id+(video?'.mp4':'.jpg')));
  const thumb=folder.createFile(Utilities.newBlob(thumbnail,'image/jpeg',id+'-thumb.jpg'));
  state.media[id]={id,kind:payload.kind,fileId:file.getId(),thumbId:thumb.getId(),size:bytes.length};
  return cmsMedia_(state,id,true);
}

function cmsGithub_(path,method,body) {
  const token=cmsProps_().getProperty('CMS_GITHUB_TOKEN');
  if (!token) cmsFail_('GitHub 게시 연결 키가 아직 설정되지 않았습니다. 글은 구글에 저장됩니다.');
  const options={method:method||'get',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},muteHttpExceptions:true};
  if(body) { options.contentType='application/json'; options.payload=JSON.stringify(body); }
  const response=UrlFetchApp.fetch(CMS_REPO+path,options), code=response.getResponseCode();
  if(code<200||code>=300) cmsFail_('GitHub 게시 요청이 거절됐습니다 ('+code+'). 키 권한·만료와 원격 변경을 확인한 뒤 다시 반영해 주세요.');
  return JSON.parse(response.getContentText());
}
function cmsBlob_(content,base64) { return cmsGithub_('/git/blobs','post',{content,encoding:base64?'base64':'utf-8'}).sha; }
function cmsOwned_(path) { return ['content/posts.json','content/release.json'].includes(path)||/^(?:news\/[a-f0-9]{32}\.html|assets\/journal\/[a-f0-9]{32}(?:-poster)?\.(?:jpg|mp4))$/.test(path); }
function cmsSyncSafely_(state) {
  state.publication={phase:'sending',message:'홈페이지로 전송 중입니다.',started:Date.now()}; cmsWrite_(state);
  try { cmsSync_(state); }
  catch(error) { state.publication.phase='error'; state.publication.message=error.cmsSafe?error.message:'전송하지 못했습니다. 글은 구글에 저장되어 있습니다. 다시 반영해 주세요.'; }
  cmsWrite_(state);
}
function cmsStatus_(state) {
  const status=Object.assign({},state.publication,{enabled:true,siteUrl:CMS_SITE});
  if(status.phase==='building') {
    const cache=CacheService.getScriptCache(), key='cms-live-'+status.release;
    let live=cache.get(key)==='yes';
    if(!live) try { const result=UrlFetchApp.fetch(CMS_SITE+'/content/release.json?cms='+status.release+'&t='+Date.now(),{muteHttpExceptions:true}); live=result.getResponseCode()===200&&JSON.parse(result.getContentText()).id===status.release; if(live)cache.put(key,'yes',600); } catch(error) {}
    if(live) { status.phase='live';status.message='홈페이지 반영을 확인했습니다.'; }
    if(status.phase==='building' && Date.now()-status.started>600000) { status.phase='unconfirmed';status.message='전송은 완료됐지만 홈페이지 반영을 아직 확인하지 못했습니다. 다시 반영해 주세요.'; }
  }
  if(!cmsProps_().getProperty('CMS_GITHUB_TOKEN')) { status.phase='error';status.message='GitHub 게시 연결 키가 필요합니다. 임시저장은 사용할 수 있습니다.'; }
  return status;
}
function cmsSync_(state) {
  const base=cmsGithub_('/git/ref/heads/main'), commit=cmsGithub_('/git/commits/'+base.object.sha), tree=cmsGithub_('/git/trees/'+commit.tree.sha+'?recursive=1');
  if(tree.truncated) cmsFail_('저장소 파일이 많아 안전하게 반영할 수 없습니다.');
  const files={}; tree.tree.filter(x=>x.type==='blob').forEach(x=>files[x.path]=x);
  function read(path) { if(!files[path]) cmsFail_('홈페이지 연결 파일을 찾지 못했습니다.'); const blob=cmsGithub_('/git/blobs/'+files[path].sha); return Utilities.newBlob(Utilities.base64Decode(blob.content.replace(/\s/g,''))).getDataAsString('UTF-8'); }
  const prior=JSON.parse(read('content/cms-manifest.json')), instance=cmsProps_().getProperty('CMS_INSTANCE_ID');
  if(!Array.isArray(prior.files)||prior.files.some(p=>!cmsOwned_(p))) cmsFail_('게시 파일 목록이 올바르지 않습니다.');
  if(prior.ownerId!==instance && prior.files.some(p=>p.startsWith('news/')||p.startsWith('assets/journal/'))) cmsFail_('기존 관리자에 공개 게시물이 있습니다. 데이터를 이전한 뒤 연결해 주세요.');
  const pending={}, summaries=[], sitemap=read('sitemap.xml').replace(/<url>\s*<loc>https:\/\/www\.plierg\.com\/news\/[a-f0-9]{32}\.html<\/loc>[\s\S]*?<\/url>/g,''), posts=Object.values(state.posts).filter(p=>p.published).sort((a,b)=>b.updated.localeCompare(a.updated));
  const mediaIds=[...new Set(posts.flatMap(p=>p.published.blocks.filter(b=>b.mediaId).map(b=>b.mediaId)))];
  const total=Object.values(files).filter(f=>!cmsOwned_(f.path)).reduce((n,f)=>n+(f.size||0),0)+mediaIds.reduce((n,id)=>n+(state.media[id].sourcePath?0:state.media[id].size+300000),0);
  if(total>800*1024*1024) cmsFail_('홈페이지 용량이 800MB를 넘습니다. 큰 영상은 유튜브 링크로 바꿔 주세요.');
  mediaIds.forEach(id=>{
    const asset=state.media[id], path='assets/journal/'+id+(asset.kind==='video'?'.mp4':'.jpg');
    if(asset.sourcePath) {
      cmsArchiveAsset_(asset);
      if(!files[asset.sourcePath]||!files[asset.thumbnailPath]) cmsFail_('기존 사진첩의 사진 파일을 찾지 못했습니다. 원본 파일을 유지해 주세요.');
      return;
    }
    pending[path]=files[path]?files[path].sha:cmsBlob_(Utilities.base64Encode(cmsFile_(asset.fileId).getBlob().getBytes()),true);
    if(asset.kind==='video') { const poster='assets/journal/'+id+'-poster.jpg'; pending[poster]=files[poster]?files[poster].sha:cmsBlob_(Utilities.base64Encode(cmsFile_(asset.thumbId).getBlob().getBytes()),true); }
  });
  posts.forEach(row=>{
    const post=JSON.parse(JSON.stringify(row.published)); post.id=row.id;post.url='/news/'+row.id+'.html';post.media={};
    post.displayMode=post.displayMode||'story';
    if(row.legacyKey) post.legacyKey=row.legacyKey;
    post.blocks.filter(b=>b.mediaId).forEach(b=>{const asset=state.media[b.mediaId];post.media[b.mediaId]={id:b.mediaId,kind:asset.kind,status:'ready',url:asset.sourcePath?'/'+asset.sourcePath:'/assets/journal/'+b.mediaId+(asset.kind==='video'?'.mp4':'.jpg'),thumbnail:asset.sourcePath?'/'+asset.thumbnailPath:'',poster:asset.kind==='video'?'/assets/journal/'+b.mediaId+'-poster.jpg':'',size:asset.size,error:''};});
    pending['news/'+row.id+'.html']=cmsBlob_(cmsArticle_(post),false);
    delete post.blocks;post.media=post.coverId?{[post.coverId]:post.media[post.coverId]}:{};summaries.push(post);
  });
  pending['content/posts.json']=cmsBlob_(JSON.stringify({posts:summaries,migratedArchives:cmsArchiveKeys_(state)}),false);
  pending['sitemap.xml']=cmsBlob_(sitemap.replace('</urlset>',posts.map(p=>'<url><loc>'+CMS_SITE+'/news/'+p.id+'.html</loc><lastmod>'+p.published.updatedAt+'</lastmod></url>').join('')+'</urlset>'),false);
  const release=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(pending)).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');
  pending['content/release.json']=cmsBlob_(JSON.stringify({id:release}),false);
  pending['content/cms-manifest.json']=cmsBlob_(JSON.stringify({version:1,ownerId:instance,files:Object.keys(pending).filter(cmsOwned_).sort()}),false);
  const updates=Object.keys(pending).filter(path=>!files[path]||files[path].sha!==pending[path]).map(path=>({path,mode:'100644',type:'blob',sha:pending[path]}));
  prior.files.filter(path=>!pending[path]&&files[path]).forEach(path=>updates.push({path,mode:'100644',type:'blob',sha:null}));
  let sha=base.object.sha;
  if(updates.length) { const nextTree=cmsGithub_('/git/trees','post',{base_tree:commit.tree.sha,tree:updates}); const next=cmsGithub_('/git/commits','post',{message:'Publish Plie journal from Google administrator',tree:nextTree.sha,parents:[base.object.sha]}); cmsGithub_('/git/refs/heads/main','patch',{sha:next.sha,force:false});sha=next.sha; }
  state.publication={phase:'building',message:'전송했습니다. 홈페이지 배포를 확인하고 있습니다.',commit:sha,release,started:Date.now()};
}
function cmsArticle_(post) {
  const e=cmsEscape_, categories={notice:'공지사항',class:'수업 이야기',event:'행사 · 발표회',competition:'대회 소식'}, media=post.media, cover=media[post.coverId];
  const parts=[], gallery=[];
  const flush=()=>{if(gallery.length) {parts.push('<div class="article-gallery">'+gallery.join('')+'</div>');gallery.length=0;}};
  post.blocks.forEach(b=>{
    const caption=b.caption?'<figcaption>'+e(b.caption)+'</figcaption>':'';
    if(post.displayMode==='gallery'&&b.type==='image') {
      const asset=media[b.mediaId], alt=b.alt||post.title;
      gallery.push('<figure class="article-gallery-item"><button class="article-gallery-open" type="button" data-image-open="'+e(asset.url)+'" aria-label="'+e(alt+' 크게 보기')+'"><img src="'+e(asset.thumbnail||asset.url)+'" alt="'+e(alt)+'" loading="lazy" decoding="async"></button>'+caption+'</figure>');
      return;
    }
    flush();
    if(b.type==='text') {parts.push('<p>'+e(b.text).replace(/\n/g,'<br>')+'</p>');return;}
    if(b.type==='heading') {parts.push('<h2>'+e(b.text)+'</h2>');return;}
    const content=b.type==='youtube'?'<iframe class="youtube" src="https://www.youtube-nocookie.com/embed/'+e(b.videoId)+'" title="'+e(b.caption||'플리에 영상')+'" loading="lazy" allowfullscreen></iframe>':b.type==='image'?'<img src="'+e(media[b.mediaId].url)+'" alt="'+e(b.alt||post.title)+'" loading="lazy">':'<video controls playsinline preload="metadata" poster="'+e(media[b.mediaId].poster)+'" src="'+e(media[b.mediaId].url)+'"></video>';
    parts.push('<figure>'+content+caption+'</figure>');
  });
  flush();
  const body=parts.join('');
  const canonical=CMS_SITE+post.url, image=CMS_SITE+(cover?(cover.poster||cover.url):'/assets/logo.png');
  const schema=JSON.stringify({'@context':'https://schema.org','@type':'Article',headline:post.title,description:post.excerpt,datePublished:post.publishedAt,dateModified:post.updatedAt,image,mainEntityOfPage:canonical,author:{'@type':'Organization',name:'플리에 리듬체조 아카데미'}}).replace(/</g,'\\u003c');
  const replacements={TITLE:e(post.title),DESCRIPTION:e(post.excerpt),CANONICAL:e(canonical),COVER:e(image),CATEGORY:categories[post.category],DATE:post.publishedAt.slice(0,10).replace(/-/g,'.'),BODY:body,JSONLD:schema};
  return HtmlService.createHtmlOutputFromFile('Article').getContent().replace(/\{\{([A-Z]+)\}\}/g,(_,key)=>replacements[key]||'');
}
