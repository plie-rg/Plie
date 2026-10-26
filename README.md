# PLIÉ

Static website project for the PLIÉ academy.

## 게시물·사진·영상 관리자

**플리에 게시물 관리 실행.cmd**를 더블클릭하고 최초 관리자 비밀번호를 설정합니다. 아이디는 `plie`이며 Google 계정과 별도의 관리자 로그인입니다.

- 관리자: `http://127.0.0.1:8766/cms/`
- 실제 홈페이지 소식: https://www.plierg.com/videos.html
- PC에서 미리보기: `http://127.0.0.1:8766/index.html`

글·사진·영상 파일·유튜브 첨부, 임시저장·미리보기·게시·수정·게시 중단을 지원합니다. 이 PC에 비공개 게시 연결 설정이 있으면 **홈페이지에 게시** 버튼이 공개용 HTML·사진·영상만 GitHub `main`에 전송합니다. 상단에 홈페이지 반영 완료가 표시될 때까지 관리 프로그램을 켜 둡니다. 게시 후에는 PC를 꺼도 홈페이지가 열립니다.

초안·로그인·원본 데이터는 `cms-app/data/`에만 저장됩니다. 공개된 내용은 Git 이력에 남을 수 있으므로 게시 중단이 영구 삭제를 뜻하지는 않습니다. 다른 PC에서 소스만 받은 경우 자동 게시가 켜지지 않습니다. [실행·백업·자동 게시 안내](cms-app/README.md)를 참고하세요.

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
