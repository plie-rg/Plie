# Pli&eacute; Website

정적 사이트라서 GitHub Pages에 바로 올릴 수 있습니다.

## 로컬에서 보기

가장 쉬운 방법:

- `start-local.bat`를 더블클릭
- 브라우저에서 `http://127.0.0.1:4173` 열기

직접 실행:

```bash
python -m http.server 4173 --bind 127.0.0.1
```

## 파일 구성

- `index.html`: 메인 페이지
- `styles.css`: 전체 스타일
- `script.js`: 모바일 메뉴, 연도 표시
- `assets/`: 로고 및 강사진 이미지
- `start-local.bat`: 로컬 미리보기 실행
- `CNAME.example`: 커스텀 도메인 연결용 예시 파일

## GitHub Pages 배포

1. 새 GitHub 저장소를 만듭니다.
2. 이 폴더 파일들을 그대로 업로드합니다.
3. GitHub 저장소의 `Settings > Pages`로 이동합니다.
4. `Deploy from a branch`를 선택하고 `main` 브랜치의 `/root`를 지정합니다.
5. 몇 분 뒤 기본 주소가 열리면 배포 완료입니다.

## 커스텀 도메인 연결

1. `CNAME.example`를 `CNAME`으로 이름 변경합니다.
2. 파일 안의 `your-domain.com`을 실제 도메인으로 바꿉니다.
3. GitHub Pages 설정의 `Custom domain`에도 같은 도메인을 입력합니다.
4. 도메인 업체 DNS에서 아래처럼 연결합니다.

- 루트 도메인: GitHub Pages A 레코드
- 서브도메인(`www`): `CNAME` 레코드로 `<username>.github.io`

## 현재 반영된 공개 정보

- 대표 문의 전화: `010-3865-8181`
- 대표 메일: `plie_rg@naver.com`
- 인스타그램: `@plie_rg_academy`
- 위치: `서울특별시 강서구 마곡동 739-1, 311호`

## 확인 필요 항목

- 실제 도메인명
- 지도 링크 또는 네이버지도/카카오맵 링크
- 강사진 상세 이력/자격 공개 범위
- 체험수업 신청 폼 연결 여부
