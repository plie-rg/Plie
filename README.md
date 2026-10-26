# PLIÉ

Static website project for the PLIÉ academy.

## 게시물·사진·영상 CMS 개발판

외부 CMS 가입 없이 사용하는 자체 관리자 소스는 `cms-app/`입니다. **플리에 게시물 관리 실행.cmd**를 더블클릭하고 최초 관리자 비밀번호를 설정합니다. 아이디는 `plie`이며 Google 계정과 별도의 관리자 로그인입니다.

- 관리자: `http://127.0.0.1:8766/cms/`
- CMS가 연결된 홈페이지 미리보기: `http://127.0.0.1:8766/index.html`
- 소식: `http://127.0.0.1:8766/videos.html`

글·사진·MP4/MOV/WebM 업로드·유튜브 첨부, 순서 변경, 대표 이미지, 임시저장·게시·수정·게시 중단·삭제를 지원합니다. 동영상은 웹 재생용 MP4로 변환하고 표지를 생성합니다. 게시물별 서버 렌더링 HTML·공유 메타정보·사이트맵이 생성됩니다. 공개 글의 수정 초안은 게시할 때까지 공개본과 분리됩니다.

지금은 로컬 개발 홈페이지에 반영되며 공개 사이트에는 배포하지 않았습니다. CMS 소스는 개발 브랜치에서 관리합니다. GitHub Pages만으로 업로드 서버를 운영할 수 없으므로 공개 전환에는 상시 서버와 영구 저장 공간을 연결해야 합니다. [실행·저장·운영 안내](cms-app/README.md)를 참고하세요.

## Run locally

Use the built-in preview server:

```bash
python run_site.py
```

Then open:

- Desktop: `http://127.0.0.1:8000/index.html`
- Phone on same Wi-Fi: `http://<your-computer-ip>:8000/index.html`

Options:

```bash
python run_site.py --port 9000
python run_site.py --no-browser
```
