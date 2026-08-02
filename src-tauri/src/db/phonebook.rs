use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;
use super::model::PhonebookEntry;

pub fn load_phonebook(conn: &Connection) -> DbResult<Vec<PhonebookEntry>> {
    let mut stmt =
        conn.prepare("SELECT id, who, org, phone, email FROM phonebook ORDER BY sort_order, id")?;
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(PhonebookEntry {
            id: row.get(0)?,
            who: row.get(1)?,
            org: row.get(2)?,
            phone: row.get(3)?,
            email: row.get(4)?,
        });
    }
    Ok(out)
}

pub fn save_phonebook_tx(tx: &Transaction, entries: &[PhonebookEntry]) -> DbResult<()> {
    tx.execute("DELETE FROM phonebook", [])?;
    {
        // OR IGNORE — see fields.rs: dup ids must not abort the whole save.
        let mut ins = tx.prepare(
            "INSERT OR IGNORE INTO phonebook (id, who, org, phone, email, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (i, e) in entries.iter().enumerate() {
            ins.execute(params![e.id, e.who, e.org, e.phone, e.email, i as i64])?;
        }
    }
    Ok(())
}

pub fn save_phonebook(conn: &mut Connection, entries: &[PhonebookEntry]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_phonebook_tx(&tx, entries)?;
    tx.commit()?;
    Ok(())
}

/// 미니 캡처 창의 @ 자동완성용 검색 — 이름·소속·전화(하이픈 제거 버전 포함)를
/// LIKE 로 뒤진다. 메인 창은 S.phonebook 을 메모리에서 직접 거르므로(프런트
/// phonebook-core.js) 이 함수는 메인 모듈에 접근할 수 없는 캡처 웹뷰 전용이다.
/// 이스케이프 규칙은 items::quick_search 와 동일.
///
/// v3.5.0: **이메일은 검색 대상이 아니다.** 미니 창의 @ 자동완성 행은 이름·소속·
/// 전화 셋만 보여주므로, 보이지 않는 값으로 걸리면 "왜 이 사람이 떴지"가 된다
/// (같은 이유로 메인 창 at-complete.js 의 드롭다운도 이메일로 검색하지 않는다).
/// 이메일이 보이는 전화번호부 탭·양식에서는 검색된다 — 규칙은 '보이는 곳에서만'.
pub fn search_phonebook(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> DbResult<Vec<PhonebookEntry>> {
    let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pat = format!("%{escaped}%");
    let mut stmt = conn.prepare(
        "SELECT id, who, org, phone, email FROM phonebook
         WHERE who LIKE ?1 ESCAPE '\\'
            OR org LIKE ?1 ESCAPE '\\'
            OR phone LIKE ?1 ESCAPE '\\'
            OR replace(replace(phone, '-', ''), ' ', '') LIKE ?1 ESCAPE '\\'
         ORDER BY org, who, id LIMIT ?2",
    )?;
    let mut rows = stmt.query(params![pat, limit])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push(PhonebookEntry {
            id: row.get(0)?,
            who: row.get(1)?,
            org: row.get(2)?,
            phone: row.get(3)?,
            email: row.get(4)?,
        });
    }
    Ok(out)
}
