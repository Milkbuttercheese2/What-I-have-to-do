import io, os, shutil
here = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(here, 'demo-docs'); op = os.path.join(d, '2026 나라장터 운영')
os.makedirs(os.path.join(op, '회신 문서'), exist_ok=True); os.makedirs(os.path.join(d, '참고 자료'), exist_ok=True)
def w(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)
import zipfile
# v3.9.0: 견본 한글 문서의 '마감'(표 머리·'입찰 마감 연기')을 화면 용어 '기한'으로 — 글자 수가 같아 줄 자리 정보(linesegarray)는 그대로 맞는다
src = os.path.join(here, '..', '..', '..', 'tests', 'fixtures', 'rhwp-sample.hwpx')
with zipfile.ZipFile(src) as zi, zipfile.ZipFile(os.path.join(op, '장애 조치 결과 보고.hwpx'), 'w') as zo:
    for info in zi.infolist():
        b = zi.read(info.filename)
        if info.filename.startswith('Contents/section') and info.filename.endswith('.xml'):
            b = b.decode('utf-8').replace('>마감<', '>기한<').replace('입찰 마감 연기', '입찰 기한 연기').encode('utf-8')
        zo.writestr(info, b)
w(os.path.join(op, '장애 접수 목록.csv'), "접수시각,입찰공고번호,업체,증상,처리\r\n15:32,R26BK01234567,㈜한빛정보,투찰 화면 멈춤,확인 중\r\n15:35,R26BK01234567,㈜새온테크,전송 버튼 무반응,확인 중\r\n15:41,R26BK01234567,㈜다온시스템,인증서 창 안 뜸,확인 중\r\n15:44,R26BK01229310,㈜미래정보,투찰 화면 멈춤,확인 중\r\n")
w(os.path.join(op, '장애 시간대 투찰 기록 조회.sql'), "-- 장애 시간대(15:30~16:10) 투찰 시도 기록 (장애번호 장애-26-1121)\nSELECT b.bid_no, b.biz_no, c.corp_name, b.status, b.tried_at\n  FROM bid_submit_log b\n  JOIN corp c ON c.biz_no = b.biz_no\n WHERE b.bid_no = 'R26BK01234567'\n   AND b.tried_at BETWEEN '2026-11-21 15:30' AND '2026-11-21 16:10'\n   AND b.status <> 'OK'\n ORDER BY b.tried_at;\n")
w(os.path.join(op, '센터 지정 회의 메모.md'), "# 전자조달지원센터 지정 — 부산\n\n## 검토할 것\n- 상담 인력 2명 이상 상주\n- 교육장 좌석 20석 이상\n- 운영 계획서 (2027~2028)\n\n## 다음\n- 현장 확인 일정 잡기 → 최지훈 센터장\n")
w(os.path.join(op, '회신 문서', '세종시 질의 회신 초안.txt'), "상용소프트웨어 직접구매 대상 여부 회신(초안)\r\n")
w(os.path.join(d, '참고 자료', '이용자 등록 처리 기준.md'), "# 이용자 등록 처리 기준\n\n1. 인증서 재발급은 본인 확인 후\n")
print('ok')
