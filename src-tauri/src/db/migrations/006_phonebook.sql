-- v2.7.0 전화번호부: 아이템과 독립적으로 저장되는 관련인 목록.
-- 아이템의 contacts 테이블과 컬럼 이름(who/org/phone)을 일부러 맞춘다 —
-- '아이템에서 가져오기'가 같은 모양으로 복사하고, @ 자동완성이 관련인 행을
-- 그대로 채운다(프런트 phonebook-core.js 참조).
CREATE TABLE phonebook (
  id          INTEGER PRIMARY KEY, -- caller-supplied id (JS newId()), not autoincrement
  who         TEXT NOT NULL DEFAULT '',
  org         TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
