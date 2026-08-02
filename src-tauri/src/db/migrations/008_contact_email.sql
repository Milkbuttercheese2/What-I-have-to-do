-- v3.5.0 이메일(선택) — 관련인·전화번호부에 부가 정보 한 칸을 얹는다.
-- 고유 식별은 여전히 소속·이름·전화 3칸이다(프런트 phonebook-core.js entryKey):
-- 이메일이 서로 달라도 같은 사람으로 본다. 그래서 이메일은 '키'가 아니라
-- '빈 칸일 때만 채워지는 값'으로만 다뤄진다(absorbContacts 의 전화 보강과 대칭).
-- 구 DB 는 이 컬럼이 ''로 채워지고, 구 백업은 serde(default)로 ''가 된다.
ALTER TABLE contacts ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE phonebook ADD COLUMN email TEXT NOT NULL DEFAULT '';
