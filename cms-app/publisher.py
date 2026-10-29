"""Export only public snapshots and push without touching the user's index/checkout."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET

FILE_LIMIT = 80 * 1024 * 1024
SITE_LIMIT = 800 * 1024 * 1024
MANIFEST = 'content/cms-manifest.json'


class PublishError(Exception):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def owned(path):
    return path in ('content/posts.json', 'content/release.json') or bool(re.fullmatch(
        r'(?:news/[a-f0-9]{32}\.html|assets/journal/[a-f0-9]{32}(?:-poster)?\.(?:jpg|mp4))', path))


def export_files(posts, media_root, render, origin, sitemap):
    """No directory copy: traverse references in the immutable published snapshots only."""
    files, summaries = {}, []
    for original in posts:
        post = json.loads(json.dumps(original))
        post.setdefault('displayMode', 'story')
        if not re.fullmatch(r'[a-f0-9]{32}', post['id']):
            raise PublishError('게시물 주소를 확인해 주세요.')
        for mid, asset in post['media'].items():
            if not re.fullmatch(r'[a-f0-9]{32}', mid) or asset['status'] != 'ready':
                raise PublishError('사진·영상 처리가 끝난 뒤 다시 반영해 주세요.')
            ext = '.mp4' if asset['kind'] == 'video' else '.jpg'
            for name, suffix, key in [(mid + ext, ext, 'url')] + (
                    [(mid + '.jpg', '-poster.jpg', 'poster')] if asset['kind'] == 'video' else []):
                source = media_root / name
                if source.is_symlink() or source.resolve().parent != media_root.resolve() or not source.is_file():
                    raise PublishError('게시할 첨부파일을 찾지 못했습니다. 백업을 확인해 주세요.')
                if source.stat().st_size > FILE_LIMIT:
                    raise PublishError('웹용 영상은 파일당 80MB까지 게시할 수 있습니다. 짧게 나누거나 유튜브 링크를 사용해 주세요.')
                destination = 'assets/journal/' + mid + suffix
                files[destination] = source
                asset[key] = '/' + destination
        files['news/' + post['id'] + '.html'] = render(post, origin=origin).encode('utf-8')
        post.pop('blocks', None)
        post['media'] = {k: v for k, v in post['media'].items() if k == post['coverId']}
        summaries.append(post)
    files['content/posts.json'] = encoded({'posts': summaries})
    ns = 'http://www.sitemaps.org/schemas/sitemap/0.9'
    ET.register_namespace('', ns)
    root = ET.fromstring(sitemap)
    for node in list(root):
        loc = node.find('{' + ns + '}loc')
        if loc is not None and re.fullmatch(re.escape(origin) + r'/news/[a-f0-9]{32}\.html', loc.text or ''):
            root.remove(node)
    for post in posts:
        node = ET.SubElement(root, '{' + ns + '}url')
        ET.SubElement(node, '{' + ns + '}loc').text = origin + post['url']
        ET.SubElement(node, '{' + ns + '}lastmod').text = post['updatedAt']
    files['sitemap.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    return files


class GitPublisher:
    def __init__(self, repo, data, config, snapshot, render):
        self.repo, self.data, self.config = Path(repo), Path(data), config
        self.snapshot, self.render = snapshot, render
        self.lock = threading.RLock()
        self.pending = False
        self.worker = None
        self.state_path = self.data / 'publish-status.json'
        self.state = {'phase': 'ready', 'message': '홈페이지 자동 게시가 연결되어 있습니다.'}
        if self.state_path.exists():
            self.state = json.loads(self.state_path.read_text(encoding='utf-8'))
            if self.state.get('phase') in ('queued', 'sending', 'building'):
                self.state.update(phase='error', message='반영 중 관리자가 종료됐습니다. 다시 반영을 눌러 상태를 확인해 주세요.')

    def status(self):
        with self.lock:
            return dict(self.state, enabled=True, siteUrl=self.config['origin'])

    def record(self, phase, message, **details):
        with self.lock:
            self.state.update(phase=phase, message=message, **details)
            temporary = self.state_path.with_suffix('.tmp')
            temporary.write_bytes(encoded(self.state))
            temporary.replace(self.state_path)

    def git(self, *args, index=None, input=None, timeout=120):
        env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='Never')
        if index:
            env['GIT_INDEX_FILE'] = str(index)
        result = subprocess.run(['git', '-C', str(self.repo), *args], input=input,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            # Never surface credential helpers' raw stderr or remote URLs with secrets.
            raise PublishError('GitHub 전송을 완료하지 못했습니다. 인터넷과 이 PC의 GitHub 로그인을 확인한 뒤 다시 반영해 주세요.')
        return result.stdout

    def push_snapshot(self):
        remote, branch = self.config['remote'], self.config['branch']
        self.git('fetch', '--no-tags', '--no-write-fetch-head', remote, 'refs/heads/' + branch + ':refs/plie-cms/base')
        base = self.git('rev-parse', 'refs/plie-cms/base').decode().strip()
        try:
            previous = json.loads(self.git('show', base + ':' + MANIFEST))
        except (PublishError, ValueError):
            raise PublishError('홈페이지에 게시 연결 파일이 없습니다. 연결 설정을 먼저 확인해 주세요.')
        if previous.get('ownerId') not in ('', self.config['ownerId']):
            raise PublishError('다른 관리자 저장소에서 게시한 내용이 있습니다. 기존 데이터 백업을 복구한 뒤 다시 시도해 주세요.')
        old_files = previous.get('files', [])
        if not isinstance(old_files, list) or any(not isinstance(p, str) or not owned(p) for p in old_files):
            raise PublishError('홈페이지 게시 목록 형식을 확인해 주세요.')
        files = export_files(self.snapshot(), self.data / 'media', self.render,
                             self.config['origin'], self.git('show', base + ':sitemap.xml'))
        # Hash and size-check before creating any commit. Never stage all local files.
        with tempfile.TemporaryDirectory(prefix='publish-', dir=self.data) as temporary:
            index = Path(temporary) / 'index'
            self.git('read-tree', base, index=index)
            hashes = {}
            for path, content in files.items():
                if not (owned(path) or path == 'sitemap.xml'):
                    raise PublishError('허용되지 않은 게시 파일입니다.')
                hashes[path] = (self.git('hash-object', '-w', '--', str(content)) if isinstance(content, Path)
                                else self.git('hash-object', '-w', '--stdin', input=content)).decode().strip()
            release = hashlib.sha256(encoded(hashes)).hexdigest()
            files['content/release.json'] = encoded({'id': release})
            files[MANIFEST] = encoded({'version': 1, 'ownerId': self.config['ownerId'],
                                      'files': sorted(p for p in files if owned(p))})
            for path in ('content/release.json', MANIFEST):
                hashes[path] = self.git('hash-object', '-w', '--stdin', input=files[path]).decode().strip()
            for path in set(old_files) - set(files):
                self.git('update-index', '--force-remove', '--', path, index=index)
            for path, blob in hashes.items():
                self.git('update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + path, index=index)
            tree = self.git('write-tree', index=index).decode().strip()
            entries = self.git('ls-tree', '-rlz', tree).split(b'\0')
            total = sum(int(entry.split(b'\t', 1)[0].split()[-1]) for entry in entries if entry)
            if total > SITE_LIMIT:
                raise PublishError('홈페이지 파일이 800MB를 넘습니다. 큰 영상은 유튜브 링크로 바꿔 주세요.')
            if tree == self.git('rev-parse', base + '^{tree}').decode().strip():
                return base, release
            commit = self.git('-c', 'user.name=Plie CMS', '-c', 'user.email=cms@users.noreply.github.com',
                              'commit-tree', tree, '-p', base, input=b'Publish Plie journal updates\n').decode().strip()
            # A normal fast-forward push refuses concurrent changes; a retry fetches them.
            self.git('push', remote, commit + ':refs/heads/' + branch, timeout=300)
            return commit, release

    def request(self):
        with self.lock:
            self.pending = True
            self.record('queued', '홈페이지에 반영할 내용을 준비하고 있습니다.')
            if not self.worker or not self.worker.is_alive():
                self.worker = threading.Thread(target=self.run, daemon=True)
                self.worker.start()
        return self.status()

    def check_live(self, release):
        url = self.config['origin'] + '/content/release.json?cms=' + release + '&t=' + str(int(time.time()))
        request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'PlieCMS/1'})
        with urllib.request.urlopen(request, timeout=12) as response:
            return json.loads(response.read(4096)).get('id') == release

    def run(self):
        while True:
            with self.lock:
                if not self.pending:
                    self.worker = None
                    return
                self.pending = False
                self.record('sending', '홈페이지에 글과 첨부파일을 전송하고 있습니다.')
            try:
                commit, release = self.push_snapshot()
                self.record('building', '전송했습니다. 홈페이지 배포를 확인하고 있습니다. 잠시 기다려 주세요.', commit=commit, release=release)
                deadline = time.monotonic() + 600
                while time.monotonic() < deadline:
                    with self.lock:
                        if self.pending:
                            break
                    try:
                        if self.check_live(release):
                            self.record('live', '홈페이지 반영을 확인했습니다.', commit=commit, release=release)
                            break
                    except Exception:
                        pass
                    time.sleep(5)
                else:
                    self.record('unconfirmed', 'GitHub 전송은 완료됐지만 홈페이지 반영을 아직 확인하지 못했습니다. 다시 반영을 눌러 확인해 주세요.')
            except PublishError as error:
                self.record('error', str(error))
            except Exception:
                self.record('error', '반영을 완료하지 못했습니다. 글은 PC에 저장되어 있습니다. 다시 반영해 주세요.')
