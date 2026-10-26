# PLIÉ

Static website project for the PLIÉ academy.

## 게시물·사진·영상 관리자

공개 홈페이지에는 관리자 링크를 표시하지 않습니다. 관리자는 Google 관리자 전용 주소를 브라우저 즐겨찾기에 저장해 직접 엽니다. 허용 계정은 `plie0312@gmail.com`이며, Google 웹 앱은 '나만' 접근으로 배포합니다. PC 관리 프로그램을 켜 둘 필요 없이 글·사진·MP4·유튜브 링크를 편집할 수 있습니다.

초안과 원본은 비공개 Google Drive에 저장합니다. **홈페이지에 게시**를 누르면 공개할 내용만 GitHub `main`으로 전송하며, 홈페이지 반영 완료를 확인한 뒤 실제 소식 페이지에서 확인합니다. 게시 취소·삭제가 공개 Git 이력의 영구 삭제를 뜻하지는 않습니다.

[Google 관리자 설치·게시 연결 안내](cms-google/SETUP.txt)를 참고하세요. 연결 키는 Apps Script의 `CMS_GITHUB_TOKEN` 스크립트 속성에만 저장합니다. 저장소에 키를 넣지 않습니다. 관리자 화면 진입은 사용자 확인을 받았으며 실제 게시 검증은 남아 있습니다.

기존 PC 관리자 `cms-app`은 이전용으로 남겨 두었습니다. 기존 PC 데이터는 Google로 자동 이전되지 않습니다. Google 게시 전환 확인 후 PC 자동 게시 설정을 해제합니다.

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
