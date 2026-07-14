-- v3.0.0: 업무에 연결된 파일 경로 링크 (파일 링크 기능).
-- 경로는 사용자 PC의 절대경로 문자열 그대로 저장한다 — 검증/정규화하지 않음
-- (내부망 공유 드라이브 UNC 경로 \\server\share\... 도 그대로 담기게).
CREATE TABLE item_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_item_files_item ON item_files(item_id);
