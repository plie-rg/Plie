"""Exercise the real local CMS against temporary data, never the user's store."""
import json
from pathlib import Path
import subprocess
import tempfile
import threading

import app
from playwright.sync_api import sync_playwright, expect

def main():
    qa=app.ROOT/'qa';qa.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='plie-cms-browser-') as temporary:
        app.initialize(Path(temporary)/'data')
        server=app.http.server.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        server.daemon_threads=True
        app.ORIGIN=base=f'http://127.0.0.1:{server.server_address[1]}'
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        key=(app.DATA/'.setup-key').read_text()
        video=Path(temporary)/'sample.mp4'
        subprocess.run([app.imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0xc8ad7f:s=320x240:d=1','-c:v','libx264','-pix_fmt','yuv420p',str(video)],check=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        checks=[]; errors=[]
        try:
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True)
                context=browser.new_context(viewport={'width':1440,'height':1000})
                context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base+'/') else route.abort())
                page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('dialog',lambda dialog:dialog.accept())
                page.goto(base+'/cms/#setup='+key)
                page.get_by_label('비밀번호',exact=True).fill('Plie browser QA 1234!')
                page.get_by_label('비밀번호 확인',exact=True).fill('Plie browser QA 1234!')
                page.get_by_role('button',name='관리 시작하기',exact=True).click()
                expect(page.get_by_role('heading',name='플리에의 오늘을 기록하세요.')).to_be_visible()
                checks.append('Initial owner setup and cookie login')
                page.get_by_role('button',name='＋ 새 게시물',exact=True).click()
                page.locator('#title').fill('사진과 영상으로 남기는 플리에의 하루')
                page.locator('#excerpt').fill('개발 기능 검증용 게시물입니다. 실제 홈페이지에는 게시되지 않습니다.')
                page.get_by_role('button',name='＋ 글',exact=True).click()
                page.locator('[data-value="text"]').fill('글 사이에 사진과 영상을 넣고, 원하는 순서로 정리할 수 있습니다.\n이 글은 임시 테스트 저장소에서만 사용합니다.')
                with page.expect_file_chooser() as chooser:
                    page.get_by_role('button',name='＋ 사진',exact=True).click()
                chooser.value.set_files(app.SITE/'assets/events/kyunghee-cup/thumbs/kyunghee-cup-01.jpg')
                expect(page.locator('[data-block] img')).to_have_count(1)
                page.locator('[data-value="caption"]').fill('사진을 직접 올리고 설명을 붙일 수 있어요.')
                page.locator('[data-value="alt"]').fill('플리에 행사 사진 · 개발 확인용')
                page.get_by_role('button',name='임시저장',exact=True).click()
                expect(page.locator('#save-state')).to_have_text('저장된 게시물')
                public=browser.new_context(viewport={'width':1280,'height':900})
                public.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base+'/') else route.abort())
                visitor=public.new_page();visitor.on('pageerror',lambda error:errors.append(str(error)))
                visitor.goto(base+'/videos.html')
                expect(visitor.locator('[data-cms-grid] .journal-card')).to_have_count(0)
                checks.append('Real photo upload, draft persists, anonymous feed excludes draft')
                with page.expect_file_chooser() as chooser:
                    page.get_by_role('button',name='＋ 영상 파일',exact=True).click()
                chooser.value.set_files(video)
                expect(page.locator('[data-block] video')).to_have_count(1,timeout=30000)
                checks.append('Real MP4 upload, transcoding, generated poster, processing UI')
                page.get_by_role('button',name='＋ 유튜브',exact=True).click()
                page.locator('[data-value="url"]').fill('https://youtu.be/abcdefghijk')
                page.get_by_role('button',name='미리보기',exact=True).click()
                expect(page.locator('#preview')).to_be_visible()
                expect(page.locator('#preview-content img')).to_have_count(1)
                expect(page.locator('#preview-content video')).to_have_count(1)
                expect(page.locator('#preview-content')).to_contain_text('유튜브 영상:')
                page.get_by_role('button',name='미리보기 닫기',exact=True).click()
                checks.append('Mixed text/photo/video/YouTube blocks and preview')
                page.screenshot(path=str(qa/'cms-editor.png'),full_page=True)
                page.get_by_role('button',name='게시하기',exact=True).click()
                expect(page.get_by_role('button',name='수정 내용 게시',exact=True)).to_be_visible()
                visitor.reload()
                expect(visitor.locator('.journal-card')).to_have_count(1)
                article=visitor.locator('.journal-card .journal-read').get_attribute('href')
                visitor.goto(base+article)
                expect(visitor.get_by_role('heading',name='사진과 영상으로 남기는 플리에의 하루',exact=True)).to_be_visible()
                expect(visitor.locator('video')).to_have_count(1)
                visitor.locator('video').evaluate('(v)=>v.play()')
                visitor.wait_for_function('() => document.querySelector("video").currentTime > 0')
                assert visitor.locator('meta[property="og:title"]').get_attribute('content')=='사진과 영상으로 남기는 플리에의 하루'
                assert 'Article' in visitor.locator('script[type="application/ld+json"]').text_content()
                checks.append('Published list, SSR article, metadata, actual video playback')
                visitor.screenshot(path=str(qa/'cms-article.png'),full_page=True)
                visitor.goto(base+'/index.html')
                expect(visitor.locator('[data-cms-section="home"] .journal-card')).to_have_count(1)
                checks.append('Homepage latest stories updates from publication')
                page.locator('#title').fill('아직 공개하지 않은 수정 제목')
                page.get_by_role('button',name='임시저장',exact=True).click()
                expect(page.locator('#save-state')).to_have_text('저장된 게시물')
                visitor.goto(base+article)
                expect(visitor.get_by_role('heading',name='사진과 영상으로 남기는 플리에의 하루',exact=True)).to_be_visible()
                page.get_by_role('button',name='← 게시물 목록',exact=True).click()
                page.screenshot(path=str(qa/'cms-dashboard.png'),full_page=True)
                checks.append('Draft edits preserve the already published snapshot')
                page.locator('.post-card').click()
                page.set_viewport_size({'width':390,'height':844})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                page.screenshot(path=str(qa/'cms-mobile.png'),full_page=True)
                checks.append('Mobile editor has no horizontal overflow')
                page.get_by_role('button',name='게시 중단',exact=True).click()
                expect(page.get_by_role('heading',name='플리에의 오늘을 기록하세요.')).to_be_visible()
                response=visitor.goto(base+article);assert response.status==404
                checks.append('Unpublish removes public article')
                page.locator('.post-card').click()
                page.get_by_role('button',name='게시물 삭제',exact=True).click()
                expect(page.locator('.post-card')).to_have_count(0)
                page.get_by_role('button',name='로그아웃',exact=True).click()
                expect(page.get_by_role('button',name='로그인',exact=True)).to_be_visible()
                page.get_by_label('비밀번호',exact=True).fill('Plie browser QA 1234!')
                page.get_by_role('button',name='로그인',exact=True).click()
                expect(page.get_by_role('heading',name='플리에의 오늘을 기록하세요.')).to_be_visible()
                checks.append('Delete, logout and password login')
                browser.close()
        finally:
            server.shutdown();server.server_close();thread.join()
        assert not errors,errors
        (qa/'browser.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'temporary_data_only':True,'external_writes':0},ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'passed':len(checks),'page_errors':errors,'public_deployment':False},ensure_ascii=False))

if __name__=='__main__': main()
