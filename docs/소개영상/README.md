# 뭐하려 했더라 소개영상 (v3.8.19)

| 파일 | 무엇 |
|---|---|
| `뭐하려했더라_소개영상_v3.8.19.mp4`(저장소에 두지 않는다 — `_문서/발표자료/뭐하려했더라/v3.8.19-시연영상/` 에 둔다, 휴대폰용 1280×720 30fps 도 함께) | 약 4분 7초, 1920×1080 60fps, 내레이션 37줄 + 자막(멘트와 같은 문장) + 합성 배경음악. 시나리오 **"디지털조달관리과 김정보 주무관의 하루"**: 출근(자동 실행) → ① 아침 보드(다섯 칸·요약 숫자) → ② 오후 3시 반 전자입찰 장애(업체 전화를 받으며 Ctrl+Alt+Space 빠른 메모, @ 전화번호부 자동완성, 관련인 자동 첨부) → ③ 업무로 다듬기(세부 할 일 점검 시각 → 칸 이동, 메모 합치기, 업체 보고서를 양식에 끌어 놓아 링크) → ④ 알림·업무 종료·실행 취소 → ⑤ 문서 탭(양식 링크의 [문서] → 트리 초록 표시, 문서 찾기, 한글 쪽 보기, 한글·PDF 글자 끌어 고르기, CSV 표 고치기, SQL 의 VS Code 색, 보면서 메모·메모 칸 접기) → ⑥ 다시 찾기(빠른 검색, 하루 시간표·빈 시간에 새 업무, 완료 탭 달 넘기기·날짜) → ⑦ 사람으로 찾기(전화번호부 오른쪽 '관련 업무' 칸, 담당자 바꾸기) → ⑧ 테마·백업 → 마무리 |
| `원본/` | 다시 만드는 데 필요한 스크립트 |

'조달법령 흐름도' 시연 영상(koneps-flow `docs/시연/조달법령흐름도-심사용`)과 **같은 장면 엔진**(`원본/index.html` —
알약 → 창 전환·카메라 이동·커서·강조 테두리·자막), 같은 목소리(ElevenLabs Taehyung), 같은 음악 합성기(`music.py`)·믹서(`mix.py`)를 쓴다.
v3.7.1 판(서비스계약과 박조달 주무관)에서 v3.8.7 판으로 다시 만들었다(2026-11-21): 주인공을 디지털조달관리과로(소유자 지정), 문서 탭·전화번호부 옆 칸·완료 달력 띠·시간표에서 새 업무를 넣고, 바뀐 기능(2쪽 보기·프리셋·주기 업무 장면)은 뺐다.
v3.8.19 판(2026-11-22): 줄거리와 장 구성은 그대로 두고 새 줄 3개(f5 파일 끌어 놓아 링크 · d0 [문서] 단추 → 트리 초록 표시 · d2b 한글·PDF 글자 끌어 고르기)와 고친 줄 5개(d3 VS Code 색 · d4 메모 칸 접기 · s1 · s3 완료 탭 달 넘기기 · p1 전화번호부 새 화면)를 넣었다. 그 8줄만 음성을 새로 만들고 나머지 29줄은 v3.8.7 음성을 그대로 쓴다. 화면은 전부 v3.8.19 `src/` 로 다시 떴다.
f5 의 탐색기 끌기는 브라우저 갈무리로 찍을 수 없어 놓기 전·놓은 뒤 화면(앱의 끌어 놓기 처리 `addLinkPaths` 가 만든 링크 줄)을 찍고 끄는 동작은 영상의 커서로 보여 준다.

## 화면은 실제, 데이터는 예시

- 화면: 이 저장소의 `src/` 를 Edge 에 1920×1080(2배율)으로 그대로 띄워 갈무리했다. 미니 창은 실제 `capture.html` 을 보드 위에 띄워 찍었다.
- 문서 탭: `원본/demo-docs/` 의 실제 파일을 갈무리 서버가 내준다(`/__demo/`). 한글 문서는 앱에 들어 있는 rhwp(WebAssembly)가 실제로 그린 쪽이고, PDF(`한빛정보 장애 경위서.pdf` — 가상의 업체 경위서, `node mkpdf.mjs` 로 굽는다)는 앱의 pdf.js 가 그린다.
- 데이터: `원본/sample-data.mjs`. 부서는 「조달청과 그 소속기관 직제 시행규칙」에 맞췄다(디지털조달관리과 = 나라장터 등 조달정보화시스템 운영). 사람·업체·번호는 **가상의 예시**다.
- 윤문: 내레이션은 im-not-ai(humanize-korean, light 경로) 기준으로 연결어미 뒤 쉼표·'~를 통해'를 쓰지 않았다.
- 내레이션: `원본/script.mjs`(읽는 소리 · 화면 자막), 음성 파일은 `원본/tts/*.mp3` 로 저장돼 있어 다시 만들 때 API 를 다시 부르지 않는다.
- 음악: numpy 합성(외부 음원 없음 — 저작권 문제 없음).

## 다시 만들기(`원본/`에서, 저장소 루트에 `npm install --no-save playwright-core` 가 되어 있어야 한다)

```bash
cp ../../../src/fonts/PretendardVariable.woff2 .
node mkpdf.mjs          # (demo-docs 의 예시 PDF 가 없을 때만)
node capture.mjs        # 장면 갈무리 → shots/*.jpg, shots.json
node tts.mjs            # 문장별 음성(없는 파일만 새로 만든다 · 키는 Which-article-was-is-PPS/.env 에서 읽고 출력하지 않는다) → tts/, durations.json
node build.mjs          # 음성 길이로 자막·사건 시각 → timeline.js, cues.json
node stills.mjs         # (선택) 주요 순간 정지 화면 → stills/
python music.py && python mix.py
bash render-all.sh      # → clip.mp4 (ffmpeg 가 PATH 에 있어야 한다)
```

원고를 고치면 해당 문장의 `tts/<id>.mp3` 를 지우고 `node tts.mjs` 부터 다시 돌린다.

휴대폰용(v3.8.7 휴대폰용과 같은 설정 — 1280×720 30fps, x264 slow 2-pass 900kbps, AAC 96kbps):

```bash
ffmpeg -y -i clip.mp4 -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -b:v 900k -pass 1 -an -f mp4 NUL
ffmpeg -y -i clip.mp4 -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -b:v 900k -pass 2 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 96k -movflags +faststart phone.mp4
```
