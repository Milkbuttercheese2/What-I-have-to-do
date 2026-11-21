-- 장애 시간대(15:30~16:10) 투찰 시도 기록 (장애번호 장애-26-1121)
SELECT b.bid_no, b.biz_no, c.corp_name, b.status, b.tried_at
  FROM bid_submit_log b
  JOIN corp c ON c.biz_no = b.biz_no
 WHERE b.bid_no = 'R26BK01234567'
   AND b.tried_at BETWEEN '2026-11-21 15:30' AND '2026-11-21 16:10'
   AND b.status <> 'OK'
 ORDER BY b.tried_at;
