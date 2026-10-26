"""Offline UI fixture only. It does not authenticate Google or contact GitHub."""
from pathlib import Path
import http.server

ROOT=Path(__file__).resolve().parent
MOCK=r'''<script>
(()=>{const posts={},media={};let phase='ready';const clone=v=>JSON.parse(JSON.stringify(v));
function run(action,p){
if(action==='session')return {authenticated:true,configured:true,google:true,username:'plie0312@gmail.com · UI 테스트',csrf:'local-fixture',local:false,publishing:true};
if(action==='posts')return {posts:Object.values(posts).map(clone)};
if(action==='post')return clone(posts[p.id]);
if(action==='site-status')return {enabled:true,phase,message:'UI 테스트 화면 · 실제 Google 인증이나 홈페이지 게시가 아닙니다.'};
if(action==='upload'){const id=crypto.randomUUID().replaceAll('-','');media[id]={id,kind:p.kind,status:'ready',size:100,error:'',url:'data:'+(p.kind==='image'?'image/jpeg':'video/mp4')+';base64,'+p.base64,poster:p.kind==='video'?'data:image/jpeg;base64,'+p.thumbnail:''};return clone(media[id]);}
if(action==='save'||action==='publish'){const old=posts[p.id];posts[p.id]={...clone(p.post),id:p.id,revision:(old?.revision||0)+1,status:action==='publish'?'published':old?.status||'draft',updated:new Date().toISOString(),url:'/news/'+p.id+'.html',media:clone(media)};if(action==='publish')phase='live';return clone(posts[p.id]);}
if(action==='unpublish'){posts[p.id].status='draft';posts[p.id].revision++;return {ok:true};}
if(action==='delete'){delete posts[p.id];return {ok:true};}
if(action==='logout')return {ok:true};if(action==='site-sync')return {phase:'ready'};
throw Error('Unknown fixture action');}
function builder(success,failure){return {withSuccessHandler(fn){return builder(fn,failure);},withFailureHandler(fn){return builder(success,fn);},cmsRequest(action,payload){setTimeout(()=>{try{success({ok:true,value:run(action,payload)});}catch(e){failure(e);}},40);}};}
window.google={script:{run:builder()}};
})();
</script>'''
HTML=(ROOT/'Admin.html').read_text(encoding='utf-8').replace('<script>',MOCK+'<script>',1)
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.path.split('?')[0]!='/':self.send_error(404);return
        content=HTML.encode('utf-8');self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
if __name__=='__main__':
    print('Offline Google CMS UI fixture: http://127.0.0.1:8768/',flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1',8768),Handler).serve_forever()
