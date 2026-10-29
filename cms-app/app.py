"""Plie's own CMS. Local by default; persistent records/media, no external CMS account."""
from __future__ import annotations
import argparse, contextlib, hashlib, hmac, http.cookies, http.server, json, mimetypes, os
import re, secrets, shutil, sqlite3, subprocess, sys, threading, time, uuid
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent
sys.path.insert(0, str(ROOT / 'vendor'))
sys.path.insert(0, str(SITE))
from run_site import is_public_file
from PIL import Image, ImageOps, UnidentifiedImageError
import imageio_ffmpeg

DATA = ROOT / 'data'
ORIGIN = ''
SECURE = False
MAX_UPLOAD = 150 * 1024 * 1024
POOL = ThreadPoolExecutor(max_workers=1)
CATEGORIES = {'notice': '공지사항', 'class': '수업 이야기', 'event': '행사 · 발표회', 'competition': '대회 소식'}
NOW = lambda: datetime.now(timezone.utc).isoformat()
LOCK = threading.Lock()
ATTEMPTS = {}
PUBLISHER = None

class Problem(Exception):
    def __init__(self, message, status=400): self.message, self.status = message, status

@contextlib.contextmanager
def db():
    con = sqlite3.connect(DATA / 'cms.sqlite3', timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally: con.close()

def initialize(data):
    global DATA
    DATA = Path(data).resolve()
    (DATA / 'media').mkdir(parents=True, exist_ok=True)
    (DATA / 'incoming').mkdir(exist_ok=True)
    with db() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, draft TEXT NOT NULL, published TEXT, revision INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, path TEXT, poster TEXT, size INTEGER NOT NULL, error TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media_links(post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, media_id TEXT NOT NULL REFERENCES media(id), audience TEXT NOT NULL, PRIMARY KEY(post_id,media_id,audience));
        ''')
        # A restart must not leave a video marked as processing indefinitely.
        con.execute("UPDATE media SET status='failed', error='처리 중 서버가 종료됐습니다. 영상을 다시 올려 주세요.' WHERE status='processing'")
        exists = con.execute('SELECT 1 FROM owner').fetchone()
    key = DATA / '.setup-key'
    if not exists and not key.exists(): key.write_text(secrets.token_urlsafe(32), encoding='ascii')
    if exists: key.unlink(missing_ok=True)

def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def password_hash(password, salt): return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value): raise Problem('항목을 찾을 수 없습니다.', 404)
    return value
def text(value, limit, required=False):
    if not isinstance(value, str): raise Problem('입력 내용을 확인해 주세요.')
    value = value.strip()
    if len(value) > limit or (required and not value): raise Problem('필수 항목과 글자 수를 확인해 주세요.')
    return value

def youtube_id(value):
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or url.username or url.password or url.port: return None
        host = (url.hostname or '').removeprefix('www.')
        if host == 'youtu.be': candidate = url.path.strip('/')
        elif host in ('youtube.com', 'm.youtube.com'):
            match = re.fullmatch(r'/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})/?', url.path)
            candidate = parse_qs(url.query).get('v', [''])[0] if url.path == '/watch' else match[1] if match else ''
        else: return None
        return candidate if re.fullmatch(r'[A-Za-z0-9_-]{11}', candidate) else None
    except ValueError: return None

def validate_post(payload, publish=False):
    if not isinstance(payload, dict): raise Problem('게시물 내용을 확인해 주세요.')
    title = text(payload.get('title', ''), 100, publish)
    category = payload.get('category', 'class')
    branch = payload.get('branch', 'all')
    display_mode = payload.get('displayMode', 'story')
    if category not in CATEGORIES or branch not in ('all', 'magok', 'gangnam'): raise Problem('분류와 지점을 확인해 주세요.')
    if display_mode not in ('story', 'gallery'): raise Problem('표시 방식을 확인해 주세요.')
    blocks = payload.get('blocks', [])
    if not isinstance(blocks, list) or len(blocks) > 100: raise Problem('본문은 100개 블록까지 사용할 수 있습니다.')
    clean, media_ids = [], set()
    for block in blocks:
        if not isinstance(block, dict): raise Problem('본문 형식을 확인해 주세요.')
        kind = block.get('type')
        if kind in ('text', 'heading'):
            value = text(block.get('text', ''), 10000)
            if value: clean.append({'type': kind, 'text': value})
        elif kind in ('image', 'video'):
            media_id = identifier(block.get('mediaId'))
            with db() as con: asset = con.execute('SELECT kind,status FROM media WHERE id=?', (media_id,)).fetchone()
            if not asset or asset['kind'] != kind: raise Problem('사진 또는 영상 파일을 확인해 주세요.')
            if publish and asset['status'] != 'ready': raise Problem('사진·영상 처리가 끝난 뒤 게시해 주세요.')
            clean.append({'type': kind, 'mediaId': media_id, 'caption': text(block.get('caption', ''), 300), 'alt': text(block.get('alt', ''), 160)})
            media_ids.add(media_id)
        elif kind == 'youtube':
            value = text(block.get('url', ''), 500)
            vid = youtube_id(value)
            if not vid: raise Problem('올바른 유튜브 영상 또는 Shorts 주소를 넣어 주세요.')
            clean.append({'type': kind, 'url': 'https://www.youtube.com/watch?v=' + vid, 'videoId': vid, 'caption': text(block.get('caption', ''), 300)})
        else: raise Problem('지원하지 않는 본문 형식입니다.')
    if publish and not clean: raise Problem('글이나 사진·영상을 하나 이상 넣어 주세요.')
    cover = payload.get('coverId', '')
    if cover and cover not in media_ids: raise Problem('대표 사진은 본문에 있는 사진·영상 중 선택해 주세요.')
    if not cover: cover = next((b['mediaId'] for b in clean if b['type'] in ('image', 'video')), '')
    excerpt = text(payload.get('excerpt', ''), 180)
    if not excerpt: excerpt = next((b['text'][:140] for b in clean if b['type'] == 'text'), '')
    return {'title': title, 'category': category, 'branch': branch, 'displayMode': display_mode, 'excerpt': excerpt, 'coverId': cover, 'blocks': clean}, media_ids

def change_post(post_id, payload, action):
    value, media_ids = validate_post(payload.get('post', {}), publish=action == 'publish')
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute('SELECT * FROM posts WHERE id=?', (post_id,)).fetchone()
        if row and payload.get('revision') != row['revision']: raise Problem('다른 창에서 수정됐습니다. 목록을 새로 열어 확인해 주세요.', 409)
        if not row and payload.get('revision') not in (None, 0): raise Problem('게시물을 찾을 수 없습니다.', 404)
        now = NOW()
        current = json.loads(row['published']) if row and row['published'] else None
        published = row['published'] if row else None
        if action == 'publish':
            snapshot = dict(value, publishedAt=current.get('publishedAt', now) if current else now, updatedAt=now)
            published = json.dumps(snapshot, ensure_ascii=False)
        revision = row['revision'] + 1 if row else 1
        con.execute('INSERT INTO posts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft=excluded.draft,published=excluded.published,revision=excluded.revision,updated=excluded.updated',
                    (post_id, json.dumps(value, ensure_ascii=False), published, revision, row['created'] if row else now, now))
        con.execute("DELETE FROM media_links WHERE post_id=? AND audience='draft'", (post_id,))
        con.executemany('INSERT INTO media_links VALUES(?,?,?)', [(post_id, mid, 'draft') for mid in media_ids])
        if action == 'publish':
            con.execute("DELETE FROM media_links WHERE post_id=? AND audience='public'", (post_id,))
            con.executemany('INSERT INTO media_links VALUES(?,?,?)', [(post_id, mid, 'public') for mid in media_ids])
    return get_post(post_id)

def media_json(row):
    return {'id': row['id'], 'kind': row['kind'], 'status': row['status'], 'url': '/media/' + row['id'], 'poster': '/media/' + row['id'] + '/poster' if row['poster'] else '', 'size': row['size'], 'error': row['error']}

def get_post(post_id, public=False):
    with db() as con:
        row = con.execute('SELECT * FROM posts WHERE id=?', (identifier(post_id),)).fetchone()
        if not row or (public and not row['published']): raise Problem('게시물을 찾을 수 없습니다.', 404)
        value = json.loads(row['published'] if public else row['draft'])
        value.setdefault('displayMode', 'story')
        assets = con.execute('SELECT m.* FROM media m JOIN media_links l ON l.media_id=m.id WHERE l.post_id=? AND l.audience=?', (post_id, 'public' if public else 'draft')).fetchall()
        value.update(id=post_id, url='/news/' + post_id + '.html', media={asset['id']: media_json(asset) for asset in assets})
        if not public:
            published = json.loads(row['published']) if row['published'] else None
            if published is not None: published.setdefault('displayMode', 'story')
            value.update(revision=row['revision'], status='published' if published else 'draft', updated=row['updated'], hasChanges=bool(published and any(value.get(k) != published.get(k) for k in ('title','excerpt','category','branch','displayMode','coverId','blocks'))))
    return value

def list_posts(public=False):
    with db() as con: ids = [row[0] for row in con.execute('SELECT id FROM posts' + (' WHERE published IS NOT NULL' if public else '') + ' ORDER BY updated DESC LIMIT 500')]
    return [get_post(post_id, public) for post_id in ids]

def process_video(media_id, incoming):
    output, poster = DATA / 'media' / (media_id + '.mp4'), DATA / 'media' / (media_id + '.jpg')
    try:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        common = [ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file', '-i', str(incoming)]
        subprocess.run(common + ['-map','0:v:0','-map','0:a:0?','-map_metadata','-1','-map_chapters','-1','-vf',"scale=w='trunc(min(1280,iw)/2)*2':h=-2",'-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',str(output)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600, check=True, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if output.stat().st_size > MAX_UPLOAD: raise ValueError('large output')
        subprocess.run([ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(output),'-frames:v','1','-vf','scale=960:-2',str(poster)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=40, check=True, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        with db() as con: con.execute("UPDATE media SET status='ready',path=?,poster=?,size=? WHERE id=?", (output.name,poster.name,output.stat().st_size,media_id))
    except Exception:
        output.unlink(missing_ok=True); poster.unlink(missing_ok=True)
        with db() as con: con.execute("UPDATE media SET status='failed',error=? WHERE id=?", ('영상을 변환하지 못했습니다. 파일을 확인하거나 유튜브 링크를 사용해 주세요.',media_id))
    finally: incoming.unlink(missing_ok=True)

def save_upload(incoming, kind):
    media_id, now = uuid.uuid4().hex, NOW()
    if kind == 'image':
        path = DATA / 'media' / (media_id + '.jpg')
        try:
            Image.MAX_IMAGE_PIXELS = 40_000_000
            with Image.open(incoming) as im:
                if im.width * im.height > 40_000_000: raise ValueError('large image')
                im = ImageOps.exif_transpose(im).convert('RGB')
                im.thumbnail((2200,2200))
                im.save(path, 'JPEG', quality=88, optimize=True)
            with db() as con: con.execute('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)', (media_id,kind,'ready',path.name,None,path.stat().st_size,'',now))
        except Exception:
            path.unlink(missing_ok=True)
            raise Problem('사진을 읽지 못했습니다. JPG·PNG·WebP 파일을 사용해 주세요.')
        finally: incoming.unlink(missing_ok=True)
    else:
        with incoming.open('rb') as source: header = source.read(32)
        if header[4:8] != b'ftyp' and not header.startswith(b'\x1aE\xdf\xa3'):
            incoming.unlink(missing_ok=True)
            raise Problem('MP4·MOV·WebM 동영상 파일을 사용해 주세요.')
        with db() as con: con.execute('INSERT INTO media VALUES(?,?,?,?,?,?,?,?)', (media_id,kind,'processing',None,None,incoming.stat().st_size,'',now))
        POOL.submit(process_video, media_id, incoming)
    with db() as con: return media_json(con.execute('SELECT * FROM media WHERE id=?',(media_id,)).fetchone())

def public_snapshot():
    # One read transaction keeps the export consistent while another window edits.
    with db() as con:
        con.execute('BEGIN')
        result = []
        for row in con.execute('SELECT id,published FROM posts WHERE published IS NOT NULL ORDER BY updated DESC'):
            post = json.loads(row['published'])
            post.setdefault('displayMode', 'story')
            assets = con.execute("SELECT m.* FROM media m JOIN media_links l ON l.media_id=m.id WHERE l.post_id=? AND l.audience='public'", (row['id'],)).fetchall()
            post.update(id=row['id'], url='/news/'+row['id']+'.html', media={a['id']:media_json(a) for a in assets})
            result.append(post)
        return result


def publishing_status():
    return PUBLISHER.status() if PUBLISHER else {'enabled':False,'phase':'disabled','siteUrl':''}


def queue_publication():
    if PUBLISHER:
        PUBLISHER.request()


def article_html(post, origin=None):
    origin = origin or ORIGIN
    title, description = escape(post['title']), escape(post['excerpt'])
    blocks=[]
    gallery_open = False
    for block in post['blocks']:
        kind=block['type']
        gallery_image = post.get('displayMode', 'story') == 'gallery' and kind == 'image'
        if gallery_open and not gallery_image:
            blocks.append('</div>')
            gallery_open = False
        if gallery_image and not gallery_open:
            blocks.append('<div class="article-gallery">')
            gallery_open = True
        if kind == 'text': blocks.append('<p>'+escape(block['text']).replace('\n','<br>')+'</p>')
        elif kind == 'heading': blocks.append('<h2>'+escape(block['text'])+'</h2>')
        elif kind in ('image','video'):
            media=post['media'][block['mediaId']]
            source = escape(media['url'], quote=True)
            if kind == 'image':
                alt = escape(block['alt'] or post['title'], quote=True)
                body=f'<img src="{source}" alt="{alt}" loading="lazy" decoding="async">'
                if gallery_image: body=f'<button class="article-gallery__item" type="button" data-image-open="{source}" aria-label="{alt} 크게 보기">'+body+'</button>'
            else: body=f'<video controls playsinline preload="metadata" poster="{escape(media["poster"],quote=True)}"><source src="{source}" type="video/mp4">동영상을 재생할 수 없습니다.</video>'
            blocks.append('<figure>'+body+'<figcaption>'+escape(block['caption'])+'</figcaption></figure>')
        elif kind == 'youtube':
            blocks.append(f'<figure><iframe class="youtube" src="https://www.youtube-nocookie.com/embed/{block["videoId"]}" title="{escape(block["caption"] or "플리에 영상",quote=True)}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe><figcaption>{escape(block["caption"])}</figcaption></figure>')
    if gallery_open: blocks.append('</div>')
    canonical=origin+post['url']
    cover=post['media'].get(post['coverId'])
    cover_url=origin+(cover['poster'] or cover['url']) if cover else origin+'/assets/logo.png'
    schema=json.dumps({'@context':'https://schema.org','@type':'Article','headline':post['title'],'description':post['excerpt'],'datePublished':post['publishedAt'],'dateModified':post['updatedAt'],'image':cover_url,'author':{'@type':'Organization','name':'플리에 리듬체조 아카데미'},'mainEntityOfPage':canonical},ensure_ascii=True).replace('<',r'\u003c')
    template=(ROOT/'article.html').read_text(encoding='utf-8')
    values={'TITLE':title,'DESCRIPTION':description,'CANONICAL':escape(canonical,quote=True),'COVER':escape(cover_url,quote=True),'CATEGORY':CATEGORIES[post['category']],'DATE':post['publishedAt'][:10].replace('-','.'),'BODY':''.join(blocks),'JSONLD':schema}
    for key,value in values.items(): template=template.replace('{{'+key+'}}',value)
    return template

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = 'PlieCMS'
    def log_message(self, fmt, *args): pass  # No login/setup tokens or filenames in request logs.
    def send(self, status, body=b'', content_type='application/json; charset=utf-8', headers=None):
        if isinstance(body, (dict,list)): body=json.dumps(body,ensure_ascii=False).encode()
        elif isinstance(body,str): body=body.encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(body)))
        self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Cache-Control','no-store')
        self.send_header('Referrer-Policy','same-origin'); self.send_header('X-Frame-Options','SAMEORIGIN')
        if urlsplit(ORIGIN).hostname in ('127.0.0.1','localhost'): self.send_header('X-Robots-Tag','noindex, nofollow')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; media-src 'self' blob:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'")
        for key,value in (headers or {}).items(): self.send_header(key,value)
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def session(self, required=True):
        try:
            cookies=http.cookies.SimpleCookie(self.headers.get('Cookie',''))
            token=cookies.get('plie_cms')
            with db() as con: row=con.execute('SELECT * FROM sessions WHERE token=? AND expires>?',(digest(token.value) if token else '',time.time())).fetchone()
        except (http.cookies.CookieError,ValueError): row=None
        if not row and required: raise Problem('플리에 관리자 로그인이 필요합니다.',401)
        return row
    def body(self):
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: raise Problem('요청을 확인해 주세요.')
        if length <= 0 or length > 1_000_000: raise Problem('요청 크기를 확인해 주세요.',413)
        try:
            value=json.loads(self.rfile.read(length))
            if not isinstance(value,dict): raise ValueError()
            return value
        except (ValueError,UnicodeError): raise Problem('요청 형식을 확인해 주세요.')
    def check_request(self, mutation=False):
        if self.headers.get('Host','') != urlsplit(ORIGIN).netloc: raise Problem('접속 주소를 확인해 주세요.',403)
        if mutation and (self.headers.get('Origin') != ORIGIN or self.headers.get('Sec-Fetch-Site') == 'cross-site'): raise Problem('관리자 화면에서 다시 요청해 주세요.',403)
    def do_HEAD(self): self.do_GET()
    def do_GET(self):
        try:
            self.check_request()
            path=urlsplit(self.path).path
            if path=='/api/session':
                with db() as con: owner=con.execute('SELECT username FROM owner').fetchone()
                session=self.session(False)
                return self.send(200,{'app':'plie-content-cms','configured':bool(owner),'authenticated':bool(session),'username':owner['username'] if session else '', 'csrf':session['csrf'] if session else '', 'local':urlsplit(ORIGIN).hostname in ('127.0.0.1','localhost'), 'publishing':bool(PUBLISHER)})
            if path=='/api/site-status': self.session(); return self.send(200,publishing_status())
            if path=='/api/posts': self.session(); return self.send(200,{'posts':list_posts()})
            if path=='/api/public/posts':
                posts=list_posts(True)
                for post in posts:
                    post.pop('blocks',None)
                    post['media']={key:asset for key,asset in post['media'].items() if key==post['coverId']}
                return self.send(200,{'posts':posts})
            if path=='/content-config.js': return self.send(200,"window.PLIE_CONTENT_CONFIG = {enabled: true, feed: '/api/public/posts'};",'application/javascript; charset=utf-8')
            if path=='/sitemap.xml':
                root=ET.fromstring((SITE/'sitemap.xml').read_text(encoding='utf-8'))
                namespace='http://www.sitemaps.org/schemas/sitemap/0.9'
                ET.register_namespace('',namespace)
                for post in list_posts(True):
                    item=ET.SubElement(root,'{'+namespace+'}url')
                    ET.SubElement(item,'{'+namespace+'}loc').text=ORIGIN+post['url']
                    ET.SubElement(item,'{'+namespace+'}lastmod').text=post['updatedAt']
                return self.send(200,ET.tostring(root,encoding='utf-8',xml_declaration=True),'application/xml; charset=utf-8')
            if path=='/robots.txt':
                value='User-agent: *\nDisallow: /\n' if urlsplit(ORIGIN).hostname in ('127.0.0.1','localhost') else 'User-agent: *\nAllow: /\nDisallow: /cms/\nDisallow: /api/\nSitemap: '+ORIGIN+'/sitemap.xml\n'
                return self.send(200,value,'text/plain; charset=utf-8')
            if path.startswith('/api/media/'):
                self.session()
                with db() as con: asset=con.execute('SELECT * FROM media WHERE id=?',(identifier(path.rsplit('/',1)[-1]),)).fetchone()
                if not asset: raise Problem('파일을 찾을 수 없습니다.',404)
                return self.send(200,media_json(asset))
            if path.startswith('/media/'):
                parts=path.split('/')
                if len(parts) not in (3,4) or (len(parts)==4 and parts[3]!='poster'): raise Problem('파일을 찾을 수 없습니다.',404)
                media_id=identifier(parts[2])
                with db() as con:
                    public=con.execute("SELECT 1 FROM media_links WHERE media_id=? AND audience='public'",(media_id,)).fetchone()
                    asset=con.execute('SELECT * FROM media WHERE id=?',(media_id,)).fetchone()
                if not public and not self.session(False): raise Problem('파일을 찾을 수 없습니다.',404)
                filename=asset['poster'] if asset and len(parts)==4 else asset['path'] if asset else None
                if not filename or asset['status']!='ready': raise Problem('파일이 아직 준비되지 않았습니다.',404)
                return self.file(DATA/'media'/filename, ranged=True)
            if re.fullmatch(r'/news/[a-f0-9]{32}\.html',path): return self.send(200,article_html(get_post(path[6:-5],True)),'text/html; charset=utf-8')
            if path=='/news': return self.send(302,headers={'Location':'/news/'})
            if path in ('/news/','/news/index.html'): return self.file(SITE/'news'/'index.html')
            if path=='/cms': return self.send(302,headers={'Location':'/cms/'})
            if path in ('/cms/','/cms/index.html'): return self.file(ROOT/'web'/'index.html')
            if path in ('/cms/cms.js','/cms/cms.css'): return self.file(ROOT/'web'/path.rsplit('/',1)[-1])
            if path in ('/content.js','/content.css','/content/legacy-albums.json','/legacy-archive.js'): return self.file(SITE/path[1:])
            if path=='/': path='/index.html'
            if path in ('/index.html','/videos.html'):
                source=(SITE/path[1:]).read_text(encoding='utf-8')
                return self.send(200,source,'text/html; charset=utf-8')
            parts=tuple(path.lstrip('/').split('/'))
            if not is_public_file(parts): raise Problem('페이지를 찾을 수 없습니다.',404)
            target=SITE.joinpath(*parts).resolve()
            if not target.is_relative_to(SITE.resolve()) or not is_public_file(target.relative_to(SITE).parts): raise Problem('페이지를 찾을 수 없습니다.',404)
            return self.file(target)
        except Problem as error: self.send(error.status,{'error':error.message})
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception: self.send(500,{'error':'요청을 처리하지 못했습니다. 잠시 뒤 다시 확인해 주세요.'})
    def file(self, target, ranged=False):
        if not target.is_file(): raise Problem('파일을 찾을 수 없습니다.',404)
        if not ranged: return self.send(200,target.read_bytes(),mimetypes.guess_type(target)[0] or 'application/octet-stream')
        size=target.stat().st_size; start,end,status=0,size-1,200
        value=self.headers.get('Range')
        if value:
            match=re.fullmatch(r'bytes=(\d*)-(\d*)',value)
            if not match or not (match[1] or match[2]): return self.send(416,headers={'Content-Range':f'bytes */{size}'})
            if match[1]: start=int(match[1]); end=min(int(match[2]) if match[2] else size-1,size-1)
            else: start=max(0,size-int(match[2]))
            if start>end or start>=size: return self.send(416,headers={'Content-Range':f'bytes */{size}'})
            status=206
        self.send_response(status); self.send_header('Content-Type',mimetypes.guess_type(target)[0] or 'application/octet-stream')
        self.send_header('Content-Length',str(end-start+1)); self.send_header('Accept-Ranges','bytes'); self.send_header('Cache-Control','private, no-store'); self.send_header('X-Content-Type-Options','nosniff')
        if status==206: self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.end_headers()
        if self.command=='HEAD': return
        with target.open('rb') as source:
            source.seek(start); remaining=end-start+1
            while remaining:
                chunk=source.read(min(65536,remaining))
                if not chunk: break
                self.wfile.write(chunk); remaining-=len(chunk)
    def do_POST(self):
        try:
            self.check_request(True)
            path=urlsplit(self.path).path
            if path in ('/api/setup','/api/login'):
                payload=self.body()
                with LOCK:
                    if path=='/api/setup':
                        key=DATA/'.setup-key'
                        with db() as con: exists=con.execute('SELECT 1 FROM owner').fetchone()
                        if exists or not key.exists() or not hmac.compare_digest(key.read_text(encoding='ascii'),str(payload.get('setupToken',''))): raise Problem('최초 설정 링크를 확인해 주세요.',403)
                        password=text(payload.get('password',''),200,True)
                        if len(password)<12: raise Problem('비밀번호는 12자 이상으로 설정해 주세요.')
                        salt=secrets.token_hex(16)
                        with db() as con: con.execute('INSERT INTO owner VALUES(1,?,?,?)',('plie',salt,password_hash(password,salt)))
                        key.unlink(missing_ok=True)
                    else:
                        attempts=ATTEMPTS.get(self.client_address[0],[])
                        attempts=[at for at in attempts if at>time.time()-600]
                        if len(attempts)>=10: raise Problem('로그인 시도가 많습니다. 10분 뒤 다시 시도해 주세요.',429)
                        with db() as con: owner=con.execute('SELECT * FROM owner').fetchone()
                        password=text(payload.get('password',''),200)
                        if not owner or payload.get('username')!=owner['username'] or not hmac.compare_digest(password_hash(password,owner['salt']),owner['password']):
                            ATTEMPTS[self.client_address[0]]=attempts+[time.time()]
                            raise Problem('아이디 또는 비밀번호를 확인해 주세요.',401)
                        ATTEMPTS.pop(self.client_address[0],None)
                    token,csrf=secrets.token_urlsafe(32),secrets.token_urlsafe(24)
                    with db() as con:
                        con.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
                        con.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),csrf,time.time()+8*3600))
                return self.send(200,{'ok':True,'csrf':csrf},headers={'Set-Cookie':f'plie_cms={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800'+('; Secure' if SECURE else '')})
            session=self.session()
            if not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),session['csrf']): raise Problem('화면을 새로고침한 뒤 다시 시도해 주세요.',403)
            if path=='/api/logout':
                with db() as con: con.execute('DELETE FROM sessions WHERE token=?',(session['token'],))
                return self.send(200,{'ok':True},headers={'Set-Cookie':'plie_cms=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+('; Secure' if SECURE else '')})
            if path=='/api/upload':
                try: length=int(self.headers.get('Content-Length','0'))
                except ValueError: raise Problem('파일 크기를 확인해 주세요.')
                kind=self.headers.get('X-Media-Kind')
                if kind not in ('image','video') or length<=0 or length>MAX_UPLOAD: raise Problem('파일은 150MB 이하의 사진·영상만 올릴 수 있습니다.',413)
                if shutil.disk_usage(DATA).free<length*4+300*1024*1024: raise Problem('저장 공간이 부족합니다.',507)
                with db() as con: pending=con.execute("SELECT count(*) FROM media WHERE status='processing'").fetchone()[0]
                if kind=='video' and pending>=3: raise Problem('영상 처리 중입니다. 완료 후 다음 영상을 올려 주세요.',429)
                incoming=DATA/'incoming'/uuid.uuid4().hex
                try:
                    with incoming.open('wb') as target:
                        remaining=length
                        while remaining:
                            chunk=self.rfile.read(min(65536,remaining))
                            if not chunk: raise Problem('업로드가 중단됐습니다.')
                            target.write(chunk); remaining-=len(chunk)
                    return self.send(200,save_upload(incoming,kind))
                except Exception:
                    incoming.unlink(missing_ok=True)
                    raise
            payload=self.body()
            if path=='/api/site-sync':
                if not PUBLISHER: raise Problem('홈페이지 자동 게시가 연결되지 않았습니다.',409)
                return self.send(200,PUBLISHER.request())
            if path in ('/api/save','/api/publish'):
                post_id=identifier(payload['id']) if payload.get('id') else uuid.uuid4().hex
                post=change_post(post_id,payload,'publish' if path.endswith('publish') else 'save')
                if path=='/api/publish': queue_publication()
                return self.send(200,post)
            if path in ('/api/unpublish','/api/delete'):
                post_id=identifier(payload.get('id'))
                with db() as con:
                    con.execute('BEGIN IMMEDIATE')
                    row=con.execute('SELECT revision FROM posts WHERE id=?',(post_id,)).fetchone()
                    if not row: raise Problem('게시물을 찾을 수 없습니다.',404)
                    if row['revision']!=payload.get('revision'): raise Problem('다른 창에서 수정됐습니다. 목록을 새로 열어 주세요.',409)
                    if path.endswith('delete'): con.execute('DELETE FROM posts WHERE id=?',(post_id,))
                    else:
                        con.execute('UPDATE posts SET published=NULL,revision=revision+1,updated=? WHERE id=?',(NOW(),post_id))
                        con.execute("DELETE FROM media_links WHERE post_id=? AND audience='public'",(post_id,))
                queue_publication()
                return self.send(200,{'ok':True})
            raise Problem('요청을 찾을 수 없습니다.',404)
        except Problem as error: self.send(error.status,{'error':error.message})
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception: self.send(500,{'error':'저장하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.'})

def main():
    global ORIGIN,SECURE,PUBLISHER
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--host',default=os.environ.get('CMS_BIND_HOST','127.0.0.1'))
    parser.add_argument('--data',default=os.environ.get('CMS_DATA',str(ROOT/'data')))
    parser.add_argument('--origin',default=os.environ.get('CMS_PUBLIC_ORIGIN',''))
    args=parser.parse_args()
    ORIGIN=args.origin.rstrip('/') or f'http://127.0.0.1:{args.port}'
    parsed=urlsplit(ORIGIN)
    if parsed.scheme not in ('http','https') or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password: parser.error('Invalid origin')
    if args.host not in ('127.0.0.1','localhost') and parsed.scheme!='https': parser.error('외부 운영은 HTTPS origin과 역방향 프록시가 필요합니다.')
    SECURE=parsed.scheme=='https'
    initialize(args.data)
    config_file=DATA/'publish-config.json'
    if config_file.exists():
        config=json.loads(config_file.read_text(encoding='utf-8'))
        if config.get('enabled'):
            if config.get('remote')!='https://github.com/plie-rg/Plie.git' or config.get('branch')!='main' or config.get('origin')!='https://www.plierg.com' or not re.fullmatch(r'[a-f0-9]{32}',config.get('ownerId','')):
                parser.error('홈페이지 자동 게시 설정을 확인해 주세요.')
            from publisher import GitPublisher
            PUBLISHER=GitPublisher(SITE,DATA,config,public_snapshot,article_html)
    server=http.server.ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads=True
    print('Plie CMS: '+ORIGIN+'/cms/',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
