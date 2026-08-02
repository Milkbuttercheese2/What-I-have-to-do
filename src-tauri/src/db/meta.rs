//! 데이터 세대 번호(번호표) — 낡은 화면의 덮어쓰기를 막는 장치.
//! 자세한 배경은 migrations/007_data_version.sql 주석 참조.

use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;

const KEY: &str = "data_version";

fn parse(v: Option<String>) -> i64 {
    v.and_then(|s| s.parse::<i64>().ok()).unwrap_or(0)
}

/// 현재 번호. 행이 없거나 값이 이상하면 0 으로 본다 — 번호를 못 읽는다고
/// 저장을 막아 버리면 앱이 통째로 멈추므로, 모르면 '처음'으로 취급한다.
pub fn read_version(conn: &Connection) -> DbResult<i64> {
    Ok(parse(
        conn.query_row("SELECT value FROM meta WHERE key = ?1", params![KEY], |r| r.get(0))
            .ok(),
    ))
}

pub fn read_version_tx(tx: &Transaction) -> DbResult<i64> {
    Ok(parse(
        tx.query_row("SELECT value FROM meta WHERE key = ?1", params![KEY], |r| r.get(0))
            .ok(),
    ))
}

/// 번호를 1 올리고 새 번호를 돌려준다. 반드시 데이터를 쓰는 **같은 트랜잭션**
/// 안에서 불러야 한다 — 따로 쓰면 그 사이 다른 저장이 끼어들 수 있다.
pub fn bump_version_tx(tx: &Transaction) -> DbResult<i64> {
    let next = read_version_tx(tx)? + 1;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![KEY, next.to_string()],
    )?;
    Ok(next)
}
