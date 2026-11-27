use std::sync::LazyLock;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// Ordered schema migrations, tracked via SQLite's built-in `PRAGMA
/// user_version` (what rusqlite_migration uses internally) — no separate
/// version table needed.
///
/// IMPORTANT: only ever append new `M::up(...)` entries here. Never edit or
/// reorder an entry once it has shipped — the app has no auto-updater on
/// the target intranet, so an install may jump straight from an old schema
/// version to the newest one, skipping several releases at once.
const SCRIPTS: &[&str] = &[
    include_str!("migrations/001_init.sql"),
    include_str!("migrations/002_recurrence.sql"),
    include_str!("migrations/003_item_files.sql"),
    include_str!("migrations/004_recur.sql"),
    include_str!("migrations/005_assignee.sql"),
    include_str!("migrations/006_phonebook.sql"),
    include_str!("migrations/007_data_version.sql"),
    include_str!("migrations/008_contact_email.sql"),
];

/// 이 버전이 아는 마지막 스키마 번호(`PRAGMA user_version`). 이보다 큰 DB 는 **더 새 버전의 앱**이 만든 것이다.
pub const LATEST: i64 = SCRIPTS.len() as i64;

static MIGRATIONS: LazyLock<Migrations<'static>> =
    LazyLock::new(|| Migrations::new(SCRIPTS.iter().map(|s| M::up(s)).collect()));

pub fn migrate(conn: &mut Connection) -> Result<(), rusqlite_migration::Error> {
    MIGRATIONS.to_latest(conn)
}
