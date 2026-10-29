"""Use a temporary local Git remote; never publish fixtures to GitHub."""
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

import app
import publisher


class PublishingChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='plie-publishing-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo, self.remote = self.root/'repo', self.root/'remote.git'
        self.repo.mkdir()
        self.git('init', '--bare', str(self.remote))
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Local CMS test')
        self.git('config', 'user.email', 'cms-test@example.invalid')
        (self.repo/'content').mkdir()
        (self.repo/'content/cms-manifest.json').write_bytes(publisher.encoded({'ownerId':'','files':[]}))
        (self.repo/'sitemap.xml').write_text('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.plierg.com/about.html</loc></url></urlset>')
        (self.repo/'unrelated.txt').write_text('Keep existing website content')
        self.git('add', '.')
        self.git('commit', '-m', 'Fixture website')
        self.git('push', str(self.remote), 'main')
        self.data = self.root/'private'
        app.initialize(self.data)
        self.config = {'remote':str(self.remote),'branch':'main','origin':'https://www.plierg.com','ownerId':'a'*32}
        self.pub = publisher.GitPublisher(self.repo,self.data,self.config,app.public_snapshot,app.article_html)
        self.post_id = uuid.uuid4().hex

    def git(self, *args):
        return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.PIPE)

    def remote_file(self, name):
        return subprocess.check_output(['git','--git-dir',str(self.remote),'show','main:'+name],stderr=subprocess.PIPE)

    def post(self, title='플리에 공개 소식', media=False):
        blocks=[{'type':'text','text':'오늘의 수업 이야기 <script>alert(1)</script>'}]
        if media:
            incoming=self.data/'incoming'/'image'
            app.Image.new('RGB',(20,20),'red').save(incoming,format='PNG')
            asset=app.save_upload(incoming,'image')
            blocks.append({'type':'image','mediaId':asset['id'],'alt':'수업 사진','caption':''})
        return {'title':title,'blocks':blocks}

    def test_export_push_edit_unpublish_and_private_data_isolation(self):
        post=app.change_post(self.post_id,{'post':self.post(media=True)},'publish')
        app.change_post(uuid.uuid4().hex,{'post':self.post(title='SECRET-DRAFT')},'save')
        (self.repo/'unrelated.txt').write_text('Uncommitted user edit')
        self.git('add','unrelated.txt')
        before=self.git('write-tree')
        commit,release=self.pub.push_snapshot()
        self.assertEqual(self.git('write-tree'),before)
        self.assertEqual((self.repo/'unrelated.txt').read_text(),'Uncommitted user edit')
        self.assertEqual(self.remote_file('unrelated.txt'),b'Keep existing website content')
        feed=self.remote_file('content/posts.json').decode()
        self.assertNotIn('SECRET-DRAFT',feed)
        self.assertNotIn('/media/',feed)
        article=self.remote_file('news/'+self.post_id+'.html').decode()
        self.assertIn('https://www.plierg.com/news/',article)
        self.assertIn('&lt;script&gt;',article)
        self.assertIn('/assets/journal/',article)
        self.assertNotIn('127.0.0.1',article)
        tree=subprocess.check_output(['git','--git-dir',str(self.remote),'ls-tree','-r','--name-only','main']).decode()
        self.assertNotIn('.setup-key',tree)
        self.assertNotIn('sqlite',tree)
        self.assertEqual(json.loads(self.remote_file('content/release.json'))['id'],release)
        # An edited draft does not change the public snapshot or produce a new commit.
        app.change_post(self.post_id,{'post':self.post(title='SECRET-EDIT'),'revision':post['revision']},'save')
        self.assertEqual(self.pub.push_snapshot(),(commit,release))
        with app.db() as con:
            con.execute('UPDATE posts SET published=NULL WHERE id=?',(self.post_id,))
            con.execute("DELETE FROM media_links WHERE post_id=? AND audience='public'",(self.post_id,))
        self.pub.push_snapshot()
        manifest=json.loads(self.remote_file('content/cms-manifest.json'))
        self.assertFalse(any(p.startswith(('news/','assets/journal/')) for p in manifest['files']))
        self.assertEqual(json.loads(self.remote_file('content/posts.json')),{'posts':[]})
        with self.assertRaises(subprocess.CalledProcessError): self.remote_file('news/'+self.post_id+'.html')
        self.assertNotIn(self.post_id,self.remote_file('sitemap.xml').decode())
        self.assertIn('about.html',self.remote_file('sitemap.xml').decode())

    def test_remote_advance_refuses_overwrite_and_retry_preserves_changes(self):
        app.change_post(self.post_id,{'post':self.post()},'publish')
        original=self.pub.git
        advanced=[]
        def race(*args,**kw):
            if args[0]=='push' and not advanced:
                (self.repo/'another.txt').write_text('Remote collaborator change')
                self.git('add','another.txt');self.git('commit','-m','Concurrent change')
                self.git('push',str(self.remote),'main')
                advanced.append(True)
            return original(*args,**kw)
        with patch.object(self.pub,'git',side_effect=race):
            with self.assertRaises(publisher.PublishError): self.pub.push_snapshot()
        self.assertEqual(self.remote_file('another.txt'),b'Remote collaborator change')
        self.pub.push_snapshot()
        self.assertEqual(self.remote_file('another.txt'),b'Remote collaborator change')
        self.assertIn(self.post_id,self.remote_file('content/posts.json').decode())

    def test_other_database_cannot_erase_published_content(self):
        app.change_post(self.post_id,{'post':self.post()},'publish')
        self.pub.push_snapshot()
        self.pub.config=dict(self.config,ownerId='b'*32)
        with self.assertRaisesRegex(publisher.PublishError,'다른 관리자'): self.pub.push_snapshot()

    def test_export_preserves_gallery_mode_and_defaults_legacy_snapshots(self):
        payload=self.post(media=True);payload['displayMode']='gallery'
        app.change_post(self.post_id,{'post':payload},'publish')
        posts=app.public_snapshot()
        sitemap=(self.repo/'sitemap.xml').read_text()
        files=publisher.export_files(posts,self.data/'media',app.article_html,self.config['origin'],sitemap)
        summary=json.loads(files['content/posts.json'])['posts'][0]
        self.assertEqual(summary['displayMode'],'gallery')
        self.assertIn(b'class="article-gallery"',files['news/'+self.post_id+'.html'])
        self.assertNotIn('blocks',summary)
        posts[0].pop('displayMode')
        legacy=publisher.export_files(posts,self.data/'media',app.article_html,self.config['origin'],sitemap)
        self.assertEqual(json.loads(legacy['content/posts.json'])['posts'][0]['displayMode'],'story')
        self.assertNotIn(b'class="article-gallery"',legacy['news/'+self.post_id+'.html'])
        self.assertFalse(publisher.owned('news/index.html'))
        self.assertFalse(publisher.owned('content/legacy-albums.json'))

    def test_media_size_limit_blocks_push_without_changing_remote(self):
        app.change_post(self.post_id,{'post':self.post(media=True)},'publish')
        before=self.remote_file('content/cms-manifest.json')
        with patch.object(publisher,'FILE_LIMIT',10):
            with self.assertRaisesRegex(publisher.PublishError,'80MB'): self.pub.push_snapshot()
        self.assertEqual(self.remote_file('content/cms-manifest.json'),before)

    def test_event_date_export_order_is_unchanged_by_a_private_draft(self):
        rows={}
        for letter,event in [('a','2024-02-29'),('b','2026-09-01'),('c','')]:
            value=dict(self.post(),eventDate=event)
            with patch.object(app,'NOW',return_value='2026-10-29T00:00:00Z'):
                rows[letter]=app.change_post(letter*32,{'post':value},'publish')
        first=self.pub.push_snapshot()
        feed=json.loads(self.remote_file('content/posts.json'))['posts']
        self.assertEqual([p['id'][0] for p in feed],['b','a','c'])
        self.assertEqual([p['eventDate'] for p in feed],['2026-09-01','2024-02-29',''])
        article=self.remote_file('news/'+'a'*32+'.html').decode()
        self.assertIn('2024.02.29',article)
        self.assertIn('"datePublished": "2026-10-29T00:00:00Z"',article)
        self.assertIn('행사 날짜 미입력',self.remote_file('news/'+'c'*32+'.html').decode())
        value=dict(self.post(title='PRIVATE DATE EDIT'),eventDate='2030-01-01')
        with patch.object(app,'NOW',return_value='2031-01-01T00:00:00Z'):
            app.change_post('a'*32,{'revision':rows['a']['revision'],'post':value},'save')
        self.assertEqual(self.pub.push_snapshot(),first)
        self.assertEqual(json.loads(self.remote_file('content/posts.json'))['posts'],feed)

    def test_worker_only_reports_live_after_matching_http_release(self):
        self.pub.pending=True
        with patch.object(self.pub,'check_live',return_value=True): self.pub.run()
        self.assertEqual(self.pub.status()['phase'],'live')
        self.pub.record('sending','In progress')
        restarted=publisher.GitPublisher(self.repo,self.data,self.config,app.public_snapshot,app.article_html)
        self.assertEqual(restarted.status()['phase'],'error')
        self.pub.pending=True
        with patch.object(self.pub,'push_snapshot',side_effect=publisher.PublishError('Connection failed')): self.pub.run()
        self.assertEqual(self.pub.status()['phase'],'error')


if __name__=='__main__': unittest.main()
