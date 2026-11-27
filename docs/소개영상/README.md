# 뭐하려 했더라 소개영상 (v3.9.0)

| 파일 | 무엇 |
|---|---|
| `뭐하려했더라_소개영상_v3.9.0.mp4`(저장소에 두지 않는다 — `_문서/발표자료/뭐하려했더라/v3.9.0-시연영상/` 에 둔다, 휴대폰용 1280×720 30fps 도 함께) | 4분 29.8초, 1920×1080 60fps, 내레이션 41줄 + 자막(멘트와 같은 문장) + 합성 배경음악. 시나리오 **"디지털조달관리과 김정보 주무관의 하루"**: 출근(자동 실행) → ① 아침 보드(다섯 칸·요약 숫자) → ② 오후 3시 반 전자입찰 장애(업체 전화를 받으며 Ctrl+Alt+Space 빠른 메모, @ 전화번호부 자동완성, 관련인 자동 첨부) → ③ 업무로 다듬기(하위 업무 점검 시각 → 칸 이동, 업체 보고서를 양식에 끌어 놓아 링크) → ④ 알림·업무 완료·실행 취소 → ⑤ 문서 탭(양식 링크의 [문서] → 트리 초록 표시, 문서 찾기, 한글 쪽 보기, 한글·PDF 글자 끌어 고르기, 보면서 메모·메모 칸 접기) → ⑥ 다시 찾기(빠른 검색, 하루 시간표·빈 시간에 새 업무, 완료 탭 달 넘기기·날짜) → ⑦ 사람으로 찾기(전화번호부 '관련 업무' 칸, 담당자 바꾸기) → **⑧ 자리를 비우기 전, 일 넘기기**(메모 구역 제목 선, 공유 메모지를 대화창으로, 엑셀로 내보내기 — 업무 목록·연락처·파일 시트) → ⑨ 데이터는 내 PC 안에(백업) → 세 줄 요약 |
| `원본/` | 다시 만드는 데 필요한 스크립트·원고·음성 |

'조달법령 흐름도' 시연 영상(koneps-flow `docs/시연/조달법령흐름도-심사용`)과 **같은 장면 엔진**(`원본/index.html` —
알약 → 창 전환·카메라 이동·커서·강조 테두리·자막), 같은 목소리(ElevenLabs Taehyung), 같은 음악 합성기(`music.py`)·믹서(`mix.py`)를 쓴다.

## 판 이력

- v3.7.1(서비스계약과 박조달 주무관) → v3.8.7(2026-11-21): 주인공을 디지털조달관리과로(소유자 지정), 문서 탭·전화번호부 옆 칸·완료 달력 띠·시간표에서 새 업무.
- v3.8.19(2026-11-22): 새 줄 f5·d0·d2b, 고친 줄 d3·d4·s1·s3·p1. 이 판의 원본은 커밋되지 않은 채 다른 worktree 에만 있었고, v3.9.0 판을 만들며 그것을 바탕으로 가져왔다.
- **v3.9.0(2026-11-27)** — 총괄 구성안 `docs/뭐하려-했더라-소개영상-v3.9.0-구성안.md`(milkbuttercheese-hub):
  - 화면 글이 표준용어로 바뀌어(하위 업무·기한·업무 완료·진행 중|완료·알림) **모든 장면을 v3.9.0 `src/` 로 다시 찍었다.** 옛 낱말이 든 m2·f2·n2 는 고쳐 음성을 다시 만들었다.
  - 새 장 ⑧(chh·h1~h6)과 맺음 e1("넘길 땐 한 장으로"). 새로 만든 음성은 이 11줄뿐이고 나머지 30줄은 전 판 음성을 그대로 쓴다.
  - 4분 30초에 맞추려고 k1(밝게·어둡게)·d3(표·쿼리)·f4(메모 합치기)를 뺐다(음성 파일 `tts/k1·d3·f4.mp3` 는 남겨 둔다).
  - 보기 쉽게: 장 제목 알약 아래 진행 표시(`3 / 9`와 점), 누를 때 물결, 단축키 키 칩(Ctrl+Alt+Space·Ctrl+Enter), 강조 테두리 바깥을 살짝 어둡게, 작은 단추(공유 아이콘·엑셀의 붉은 기한)는 카메라를 당겨서, 보내는 사람/받는 사람 좌우 화면, 끝 요약 카드 셋. 효과 값은 awesome-ai-motion 스킬의 spotlight·cursor-click·progressive-disclosure 카드에서 시작했다.
  - 화면 속 시각은 오늘 17:10 으로 묶어 찍는다(`page.clock.setFixedTime` — 언제 찍어도 "오후 장애 → 저녁 무렵" 화면이 같다).

## 화면은 실제, 데이터는 예시

- 화면: 이 저장소의 `src/` 를 Edge 에 1920×1080(2배율)으로 그대로 띄워 갈무리했다(갈무리 서버는 127.0.0.1 의 빈 포트, 다 찍으면 끈다). 미니 창은 실제 `capture.html` 을 보드 위에 띄워 찍었다.
- 문서 탭: `원본/demo-docs/` 의 실제 파일을 갈무리 서버가 내준다(`/__demo/`). 한글 문서는 앱에 들어 있는 rhwp(WebAssembly)가 실제로 그린 쪽이고, PDF(`한빛정보 장애 경위서.pdf` — 가상의 업체 경위서, `node mkpdf.mjs`)는 앱의 pdf.js 가 그린다. 견본 한글 문서의 '마감'은 `mkdemo.py` 가 '기한'으로 바꿔 넣는다(글자 수가 같아 줄 자리 정보는 그대로).
- 새 장 ⑧:
  - 공유 미리 보기·[그림 복사]는 앱 화면 그대로다. 대화창에 붙는 메모지 그림은 앱의 [파일로 저장]이 만든 PNG 그대로(`handover/share-card.png`)이고, **대화창은 직접 그린 일반 대화창**이다(어떤 메신저의 이름·로고·색도 흉내 내지 않았다).
  - 엑셀 파일은 앱의 [엑셀로 내보내기]가 만든 바이트 그대로(`handover/업무목록.xlsx`)다. 그 파일을 이 PC 의 **한셀 뷰어**로 열어 그 창 하나만 PrintWindow 로 찍었다(`hcell-shot.ps1` — 키·마우스 입력은 보내지 않고, 내 파일 이름이 든 창만 찾고 닫는다). 시트를 넘기거나 확대하는 키를 보내지 않으려고 `handover.py views` 가 **보기 설정만 바꾼 사본**(150% 확대, '연락처·파일' 시트가 열린 채)을 만든다. 값·꾸밈은 그대로다.
  - 한셀 뷰어 창 위쪽(제목·도구 줄)과 아래쪽 시트 탭 자리는 PrintWindow 로 그려지지 않고 그 자리에 뒤의 다른 창이 비쳐 찍힌다. 그래서 `hcell-shot.ps1` 은 **표 칸 부분만 잘라 저장**하고 통그림은 남기지 않는다. 영상의 **시트 탭 줄은 `handover.py frames` 가 직접 그린 표시**다(한셀 화면이 아니다).
- 데이터: `원본/sample-data.mjs`. 부서는 「조달청과 그 소속기관 직제 시행규칙」에 맞췄다(디지털조달관리과 = 나라장터 등 조달정보화시스템 운영). 사람·업체·번호는 **가상의 예시**다.
- 윤문: 내레이션은 im-not-ai(humanize-korean, light 경로) 기준으로 연결어미 뒤 쉼표·'~를 통해'를 쓰지 않았다.
- 내레이션: `원본/script.mjs`(읽는 소리 · 화면 자막), 음성 파일은 `원본/tts/*.mp3` 로 저장돼 있어 다시 만들 때 API 를 다시 부르지 않는다.
- 음악: numpy 합성(외부 음원 없음 — 저작권 문제 없음).

## 다시 만들기(`원본/`에서. 저장소 루트에 `node_modules/playwright-core` 가 있어야 한다 — worktree 면 본 체크아웃의 것을 정션으로)

```bash
cp ../../../src/fonts/PretendardVariable.woff2 .
python mkdemo.py && node mkpdf.mjs   # (demo-docs 의 예시 파일이 없을 때만)
node capture.mjs        # 장면 갈무리 → shots/*.jpg, shots.json, handover/(공유 그림·엑셀)
python handover.py views
powershell -File hcell-shot.ps1 -Xlsx handover/intro-v390-list.xlsx -Out "$PWD/handover/hcell-list.png" -W 2580 -H 1460
powershell -File hcell-shot.ps1 -Xlsx handover/intro-v390-contacts.xlsx -Out "$PWD/handover/hcell-contacts.png" -W 2580 -H 1460
python handover.py frames   # → shots/xlsx-list.jpg, xlsx-contacts.jpg (+ 시트 탭 줄, 강조 자리)
node tts.mjs            # 문장별 음성(없는 파일만 새로 만든다 · 키는 Which-article-was-is-PPS/.env 에서 읽고 출력하지 않는다) → tts/, durations.json
node build.mjs          # 음성 길이로 자막·사건 시각 → timeline.js, cues.json
node stills.mjs         # (선택) 주요 순간 정지 화면 → stills/
python music.py && python mix.py
bash render-all.sh      # → clip.mp4 (ffmpeg 가 PATH 에 있어야 한다)
node qa.mjs             # 검사: 자막·음성 길이 대조, 음성 겹침, 소리 최고 수준·무음, 장마다 정지 화면 → qa/
```

v3.9.0 판 검사 결과(2026-11-27): 문장 41 · 음성 합 236.9초 · 영상 269.8초(4분 29.8초) · 자막과 음성 길이 어긋남 0 · 음성 겹침 0 ·
소리 최고 -0.48 dB(클리핑 없음) · 1.2초 넘는 무음 없음. 1920×1080 60fps 75.0MB, 휴대폰용 1280×720 30fps 28.8MB.

- 원고를 고치면 해당 문장의 `tts/<id>.mp3` 를 지우고 `node tts.mjs` 부터 다시 돌린다.
- `hcell-shot.ps1` 의 잘라 내는 자리(CropY 128 등)와 `handover.py` 의 강조 자리(BOXES)는 이 PC(2560×1440, 100%)의 한셀 뷰어 2024 에 맞춰 잰 값이다. 다른 PC 에서는 잘린 그림을 먼저 열어 보고 다시 잰다.

휴대폰용(1280×720 30fps, x264 slow 2-pass 750kbps, AAC 96kbps — 30MB 아래):

```bash
ffmpeg -y -i clip.mp4 -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -b:v 750k -pass 1 -an -f mp4 NUL
ffmpeg -y -i clip.mp4 -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -b:v 750k -pass 2 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 96k -movflags +faststart phone.mp4
```
