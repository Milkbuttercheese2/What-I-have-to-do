-- v3.3.7 낡은 화면이 최신 데이터를 덮어쓰는 것을 막는 '번호표'.
--
-- 이 앱의 저장은 '전체 교체'다(save_all 이 items 를 전부 지우고 다시 넣는다).
-- 그래서 오래된 상태를 들고 있는 프로세스가 저장 한 번만 해도 그 뒤에 쌓인
-- 업무가 통째로 사라진다 — 실제로 2026-07-23, 08-02(05:09·08:27) 세 차례
-- 그렇게 데이터가 7월 21일 상태로 되돌아갔다.
--
-- data_version 은 저장이 성공할 때마다 1 올라간다. 읽어갈 때 받은 번호와
-- 저장할 때 DB 의 번호가 다르면 = 그 사이 누군가 저장했다 = 내 화면은 낡았다
-- → 저장을 거부한다. settings 테이블에 두지 않는 이유: 설정 저장은 테이블을
-- 통째로 지우고 다시 쓰므로 번호가 함께 날아간다. 별도 테이블이어야 한다.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('data_version', '0');
