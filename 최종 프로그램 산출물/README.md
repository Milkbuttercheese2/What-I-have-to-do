# 최종 프로그램 산출물

조달청 실무자에게 배포하는 **Windows 실행 파일(.exe/.msi)** 이 놓이는 자리다.

## 어떻게 만들어지나

이 실행 파일은 리눅스 개발 환경에서 직접 만들 수 없다(Windows 툴체인 필요). 대신
**GitHub Actions 의 Windows 러너**가 만든다 — `.github/workflows/build-desktop.yml`.

파이프라인(수동 실행: Actions → *데스크톱 앱 빌드(수집→빌드→Windows exe)* → Run):

1. **수집(라이브)** — `secrets.LAW_OC` 로 법제처 오픈API 에서 조달청 전수 + 관련법령을
   실제로 받아 `data/snapshot.json` 생성.
2. **빌드** — 관계추출 후 자족형 `web/index.html` 생성(별표 원본 PDF 는 옵션으로 동봉).
3. **Windows 패키징** — Tauri 로 `.exe`(NSIS)·`.msi` 생성.
4. 산출물을 **이 폴더에 커밋** + 워크플로 아티팩트 + GitHub Release 로 함께 제공.

## 실행 파일 사용법

- `몇 조항이더라_x.y.z_x64-setup.exe` (또는 `.msi`) 를 실행해 설치.
- 앱은 인터넷 없이 동작한다(내부망 반입 가능).
- **전역 핫키 `Ctrl+Shift+Space`** — 다른 창을 쓰다가도 앱을 앞으로 불러 바로 검색.
- 검색창 왼쪽 칩(또는 `Ctrl` 단독 탭)으로 검색 대상을 전체·법령·행정규칙으로 전환.

> 실제 파일은 워크플로가 채운다. 이 README 만 있는 상태면 아직 빌드가 돌지 않은 것이다.
