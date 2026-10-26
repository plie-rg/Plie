"""Browser publishing check using only a disposable local Git remote."""
import json
import threading
from unittest.mock import patch
from playwright.sync_api import sync_playwright, expect
import app
from test_publisher import PublishingChecks


def main():
    fixture=PublishingChecks()
    fixture.setUp()
    app.PUBLISHER=fixture.pub
    server=app.http.server.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
    server.daemon_threads=True
    app.ORIGIN=base=f'http://127.0.0.1:{server.server_address[1]}'
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    errors=[]
    try:
        with patch.object(fixture.pub,'check_live',return_value=True), sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base+'/') else route.abort())
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('dialog',lambda dialog:dialog.accept())
            page.goto(base+'/cms/#setup='+(app.DATA/'.setup-key').read_text())
            page.get_by_label('비밀번호',exact=True).fill('Temporary publishing QA 1234!')
            page.get_by_label('비밀번호 확인',exact=True).fill('Temporary publishing QA 1234!')
            page.get_by_role('button',name='관리 시작하기',exact=True).click()
            page.get_by_role('button',name='＋ 새 게시물',exact=True).click()
            page.locator('#title').fill('자동 게시 연결 검증')
            page.get_by_role('button',name='＋ 글',exact=True).click()
            page.locator('[data-value="text"]').fill('외부에 공개하지 않는 로컬 Git 검사입니다.')
            page.get_by_role('button',name='홈페이지에 게시',exact=True).click()
            expect(page.locator('#site-state')).to_have_text('홈페이지 반영을 확인했습니다.',timeout=60000)
            feed=json.loads(fixture.remote_file('content/posts.json'))
            assert len(feed['posts'])==1
            assert feed['posts'][0]['title']=='자동 게시 연결 검증'
            page.screenshot(path=str(app.ROOT/'qa'/'cms-publishing.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.get_by_role('button',name='게시 중단',exact=True).click()
            expect(page.get_by_role('heading',name='플리에의 오늘을 기록하세요.')).to_be_visible()
            expect(page.locator('#site-state')).to_have_text('홈페이지 반영을 확인했습니다.',timeout=60000)
            # The status can briefly show the preceding release until the first poll.
            if fixture.pub.worker: fixture.pub.worker.join(timeout=30)
            assert json.loads(fixture.remote_file('content/posts.json'))=={'posts':[]}
            browser.close()
        assert not errors,errors
        print(json.dumps({'publish_to_local_git':True,'unpublish':True,'mobile':True,'page_errors':errors,'external_writes':0}))
    finally:
        if fixture.pub.worker: fixture.pub.worker.join(timeout=30)
        app.PUBLISHER=None
        server.shutdown();server.server_close();thread.join()
        fixture.doCleanups()


if __name__=='__main__':main()
