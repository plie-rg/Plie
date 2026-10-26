import http.client
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest

import app

class CMSChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='plie-cms-qa-')
        app.initialize(Path(self.temp.name)/'data')
        app.ATTEMPTS.clear()
        self.server=app.http.server.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        self.server.daemon_threads=True
        self.port=self.server.server_address[1]
        app.ORIGIN=f'http://127.0.0.1:{self.port}'
        app.SECURE=False
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.cookie=''
        self.csrf=''
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.temp.cleanup()
    def request(self,path,body=None,headers=None,anonymous=False):
        method='GET' if body is None else 'POST'
        base={}
        if not anonymous and self.cookie: base['Cookie']=self.cookie
        if body is not None:
            base.update({'Origin':app.ORIGIN,'X-CSRF-Token':self.csrf,'Content-Type':'application/json'})
            if not isinstance(body,bytes): body=json.dumps(body).encode()
        base.update(headers or {})
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=20)
        connection.request(method,path,body,base)
        response=connection.getresponse(); data=response.read(); status=response.status; returned=dict(response.getheaders()); connection.close()
        if data and returned.get('Content-Type','').startswith('application/json'): data=json.loads(data)
        return status,returned,data
    def login(self):
        token=(app.DATA/'.setup-key').read_text()
        status,headers,result=self.request('/api/setup',{'setupToken':token,'password':'Local QA password 1234!'})
        self.assertEqual(status,200,result)
        self.cookie=headers['Set-Cookie'].split(';')[0]; self.csrf=result['csrf']
        self.assertIn('HttpOnly',headers['Set-Cookie']); self.assertIn('SameSite=Strict',headers['Set-Cookie'])
        self.assertFalse((app.DATA/'.setup-key').exists())
    def payload(self):
        return {'id':'a'*32,'revision':0,'post':{'title':'플리에 QA 글','excerpt':'미리보기 설명','category':'class','branch':'magok','blocks':[{'type':'text','text':'첫 번째 본문'}]}}
    def photo(self):
        out=io.BytesIO(); app.Image.new('RGB',(80,60),(174,148,115)).save(out,'PNG')
        status,_,asset=self.request('/api/upload',out.getvalue(),{'Content-Type':'application/octet-stream','X-Media-Kind':'image'})
        self.assertEqual(status,200,asset); return asset
    def test_login_setup_origin_csrf_and_private_files(self):
        self.assertEqual(self.request('/api/posts',anonymous=True)[0],401)
        self.assertEqual(self.request('/api/setup',{'setupToken':'wrong','password':'abcdefghijklm'})[0],403)
        self.login()
        self.assertEqual(self.request('/api/setup',{'setupToken':'wrong','password':'abcdefghijklm'})[0],403)
        self.assertEqual(self.request('/api/save',self.payload(),{'Origin':'https://other.invalid'})[0],403)
        self.assertEqual(self.request('/api/save',self.payload(),{'X-CSRF-Token':'wrong'})[0],403)
        for path in ['/cms-app/data/cms.sqlite3','/cms-app/data/.setup-key','/.git/config','/assets/../cms-app/data/cms.sqlite3','/cms-app/vendor/PIL/Image.py']:
            self.assertEqual(self.request(path)[0],404,path)
        self.assertEqual(self.request('/api/session',headers={'Host':'attacker.invalid'})[0],403)
        self.assertEqual(self.request('/api/logout',{})[0],200)
        self.assertEqual(self.request('/api/posts')[0],401)
        self.assertEqual(self.request('/api/login',{'username':'plie','password':'wrong'})[0],401)
        self.assertEqual(self.request('/api/login',{'username':'plie','password':'Local QA password 1234!'})[0],200)
    def test_draft_publish_edit_revision_unpublish_and_delete(self):
        self.login(); payload=self.payload()
        status,_,saved=self.request('/api/save',payload); self.assertEqual(status,200,saved)
        self.assertEqual(self.request('/api/public/posts',anonymous=True)[2]['posts'],[])
        self.assertEqual(self.request(saved['url'],anonymous=True)[0],404)
        payload['revision']=saved['revision']; status,_,published=self.request('/api/publish',payload); self.assertEqual(status,200,published)
        self.assertIn('첫 번째 본문',self.request(published['url'],anonymous=True)[2].decode())
        self.assertEqual(self.request('/api/publish',payload)[0],409)
        payload['revision']=published['revision']; payload['post']['blocks'][0]['text']='아직 공개하면 안 되는 수정'
        status,_,draft=self.request('/api/save',payload); self.assertEqual(status,200); self.assertTrue(draft['hasChanges'])
        public=self.request(published['url'],anonymous=True)[2].decode(); self.assertIn('첫 번째 본문',public); self.assertNotIn('아직 공개하면 안 되는 수정',public)
        self.assertIn(published['id'],self.request('/sitemap.xml',anonymous=True)[2].decode())
        self.assertEqual(self.request('/api/unpublish',{'id':draft['id'],'revision':draft['revision']})[0],200)
        self.assertEqual(self.request(published['url'],anonymous=True)[0],404)
        record=self.request('/api/posts')[2]['posts'][0]
        self.assertEqual(self.request('/api/delete',{'id':record['id'],'revision':record['revision']})[0],200)
        self.assertEqual(self.request('/api/posts')[2]['posts'],[])
    def test_media_visibility_range_and_unpublish_revokes_public_access(self):
        self.login(); asset=self.photo()
        self.assertEqual(self.request(asset['url'],anonymous=True)[0],404)
        self.assertEqual(self.request(asset['url'])[0],200)
        payload=self.payload(); payload['post']['blocks'].append({'type':'image','mediaId':asset['id'],'caption':'사진 설명','alt':'QA 사진'})
        status,_,post=self.request('/api/publish',payload); self.assertEqual(status,200,post)
        status,headers,body=self.request(asset['url'],headers={'Range':'bytes=0-9'},anonymous=True)
        self.assertEqual(status,206); self.assertEqual(len(body),10); self.assertIn('bytes 0-9/',headers['Content-Range'])
        self.assertEqual(self.request(asset['url'],headers={'Range':'bytes=9999999-'},anonymous=True)[0],416)
        self.assertEqual(self.request('/api/unpublish',{'id':post['id'],'revision':post['revision']})[0],200)
        self.assertEqual(self.request(asset['url'],anonymous=True)[0],404)
        self.assertEqual(self.request(asset['url'])[0],200)
    def test_xss_youtube_validation_and_invalid_upload(self):
        self.login(); payload=self.payload(); payload['post']['title']='<img src=x onerror=alert(1)>'
        payload['post']['blocks']=[{'type':'text','text':'<script>alert(1)</script>'},{'type':'youtube','url':'https://youtu.be/abcdefghijk','caption':'<img src=x onerror=alert(1)>'}]
        status,_,post=self.request('/api/publish',payload); self.assertEqual(status,200,post)
        html=self.request(post['url'],anonymous=True)[2].decode()
        self.assertNotIn('<script>alert(1)</script>',html); self.assertIn('&lt;script&gt;',html)
        self.assertIn('https://www.youtube-nocookie.com/embed/abcdefghijk',html)
        payload['revision']=post['revision'];payload['post']['blocks'][1]['url']='https://youtube.com.attacker.invalid/watch?v=abcdefghijk'
        self.assertEqual(self.request('/api/publish',payload)[0],400)
        self.assertEqual(self.request('/api/upload',b'<svg onload=alert(1)>',{'X-Media-Kind':'image'})[0],400)
    def test_data_survives_reinitialization_without_public_draft_leak(self):
        self.login(); status,_,post=self.request('/api/save',self.payload()); self.assertEqual(status,200)
        app.initialize(app.DATA)
        self.assertEqual(self.request('/api/posts')[2]['posts'][0]['id'],post['id'])
        self.assertEqual(self.request('/api/public/posts',anonymous=True)[2]['posts'],[])
        self.assertFalse((app.DATA/'.setup-key').exists())
    def test_real_video_upload_transcodes_and_produces_poster(self):
        self.login(); source=Path(self.temp.name)/'video.mp4'
        subprocess.run([app.imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0xc8ad7f:s=160x120:d=0.4','-c:v','libx264','-pix_fmt','yuv420p',str(source)],check=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        status,_,asset=self.request('/api/upload',source.read_bytes(),{'X-Media-Kind':'video','Content-Type':'application/octet-stream'}); self.assertEqual(status,200,asset)
        for _ in range(80):
            result=self.request('/api/media/'+asset['id'])[2]
            if result['status']!='processing': break
            time.sleep(.15)
        self.assertEqual(result['status'],'ready',result)
        self.assertTrue(result['poster'])
        self.assertEqual(self.request(result['poster'])[0],200)
        payload=self.payload();payload['post']['blocks']=[{'type':'video','mediaId':asset['id'],'caption':'QA 영상'}]
        status,_,post=self.request('/api/publish',payload);self.assertEqual(status,200,post)
        self.assertIn('<video controls playsinline',self.request(post['url'],anonymous=True)[2].decode())
        self.assertEqual(self.request(result['url'],headers={'Range':'bytes=0-99'},anonymous=True)[0],206)

if __name__=='__main__': unittest.main(verbosity=2)
