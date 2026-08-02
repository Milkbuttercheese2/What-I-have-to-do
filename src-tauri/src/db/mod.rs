pub mod alarm;
pub mod backup;
pub mod error;
pub mod fields;
pub mod id_kinds;
pub mod items;
pub mod meta;
pub mod model;
pub mod phonebook;
pub mod presets;
pub mod recur_defs;
mod schema;
pub mod settings;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use error::DbResult;

/// Opens (creating if needed) the SQLite database at `path`, applies the
/// pragmas this app relies on, and runs any pending migrations.
pub fn open(path: &Path) -> DbResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    /* v3.3.1: 잠긴 DB 는 **기다린다**. 이게 없으면 앱을 껐다 바로 켤 때(이전
       프로세스가 아직 파일 잠금을 들고 있는 찰나) 새 프로세스가 즉시 SQLITE_BUSY
       로 실패하고, open_with_recovery 가 그 실패를 '파일 손상'으로 보고 **자동
       백업으로 원본을 덮어썼다** — 멀쩡한 최신 데이터가 옛 백업으로 되돌아가는
       사고. 잠금은 손상이 아니라 대기 대상이다. */
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    // Single-user desktop app, small write volume: durability over
    // throughput, and this avoids WAL's -wal/-shm sidecar files, which have
    // been observed to conflict with endpoint AV on gov intranet PCs.
    conn.pragma_update(None, "synchronous", "FULL")?;
    schema::migrate(&mut conn)?;
    Ok(conn)
}

/// 쓰기 재시도 횟수/간격 (v3.3.4). 짧게, 그러나 백신 실시간검사가 파일을
/// 붙잡는 전형적인 구간(수백 ms)은 넘기도록 잡았다.
const WRITE_RETRIES: u32 = 4;
const WRITE_RETRY_DELAY_MS: u64 = 150;

/// 이 오류가 '지금은 안 되지만 잠시 뒤엔 될' 종류인가.
///
/// `busy_timeout` 은 SQLite 가 **잠금 대기**로 인식한 경우만 기다려 준다. 실무에서
/// 저장을 깨뜨리는 나머지 절반은 그게 아니다 — 백신 실시간 검사·백업 도구·탐색기
/// 미리보기가 파일 핸들을 잠깐 쥐면 SQLite 는 `SQLITE_IOERR`(디스크 I/O 오류)나
/// `SQLITE_BUSY_SNAPSHOT` 계열을 그대로 올려 보내고, 그러면 저장은 **한 번 만에**
/// 실패로 끝났다. 이런 실패는 재시도하면 대부분 통과한다.
///
/// 반대로 재시도하면 안 되는 것(제약 위반·문법 오류·스키마 불일치 등)은 몇 번을
/// 해도 같은 결과이므로 즉시 올려 보낸다 — 여기서 걸러야 할 것은 '일시적인가'다.
fn is_transient(err: &rusqlite::Error) -> bool {
    use rusqlite::ffi::ErrorCode;
    match err {
        rusqlite::Error::SqliteFailure(e, _) => matches!(
            e.code,
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked | ErrorCode::SystemIoFailure
        ),
        _ => false,
    }
}

/* ===== v3.3.6 진단 로그 =====
   "데이터가 어느 날 갑자기 옛날 상태로 돌아가 있다"는 사고가 07-23, 08-02 두 차례
   반복됐는데, 앱이 아무 기록도 남기지 않아 **무엇이 덮었는지 알 수 없었다**.
   `eprintln!` 은 콘솔로만 나가고 exe 로 실행하면 그대로 사라진다.

   그래서 데이터 폴더 옆에 사람이 읽는 로그를 남긴다. 목적은 딱 하나 —
   다음에 또 되돌아가면 **언제·어떤 실행 파일이·몇 건을 썼는지** 바로 짚는 것.
   특히 실행 파일 경로를 남기는 게 핵심이다(옛 버전 exe 가 트레이에 살아 있다가
   옛 메모리 상태를 통째로 저장하는 것이 가장 유력한 경로다).

   원칙: 로그는 **거들 뿐** 절대 앱을 방해하지 않는다 — 실패해도 무시하고,
   업무 내용(메모·이름·번호)은 남기지 않는다(건수와 사건만). */
const LOG_MAX_BYTES: u64 = 1_000_000;

/// `<base_dir>/wmhh.log` 에 한 줄 덧붙인다. 실패는 조용히 무시한다.
pub fn log_line(base_dir: &Path, msg: &str) {
    let path = base_dir.join("wmhh.log");
    // 너무 커지면 한 번 갈아 끼운다(직전 것 하나만 보관).
    if fs::metadata(&path).map(|m| m.len() > LOG_MAX_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, base_dir.join("wmhh.log.1"));
    }
    let _ = fs::create_dir_all(base_dir);
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "[{}] pid={} {}", fs_stamp(), std::process::id(), msg);
    }
}

/// 지금 실행 중인 실행 파일 경로 — 옛 버전 exe 가 섞여 도는지 가리는 열쇠.
pub fn exe_desc() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "(알 수 없음)".into())
}

/// 일시적 실패(잠금·백신 I/O)면 잠깐 쉬었다 다시 해 본다.
///
/// 저장이 한 번 실패하면 그 변경분은 사용자 화면에만 남고 디스크엔 없다. 그래서
/// "실패했다고 알리는 것"보다 "되게 만드는 것"이 먼저다 — 프런트의 재시도 큐
/// (store.js)와 한 쌍이며, 이쪽은 초 단위 이내의 짧은 방해를 흡수한다.
pub fn with_write_retry<T>(mut op: impl FnMut() -> DbResult<T>) -> DbResult<T> {
    let mut attempt = 0;
    loop {
        match op() {
            Ok(v) => return Ok(v),
            Err(e) => {
                let transient = match &e {
                    error::DbError::Sqlite(se) => is_transient(se),
                    _ => false,
                };
                if !transient || attempt >= WRITE_RETRIES {
                    return Err(e);
                }
                eprintln!("write attempt {} hit a transient DB error: {e} — retrying", attempt + 1);
                std::thread::sleep(std::time::Duration::from_millis(
                    WRITE_RETRY_DELAY_MS * (attempt as u64 + 1),
                ));
                attempt += 1;
            }
        }
    }
}

/// Runs `PRAGMA integrity_check`. Anything other than "ok" means the file
/// is corrupt — callers must refuse to proceed with an empty/partial
/// dataset in that case (this replaces the legacy app's `LOADED` gate,
/// which existed for the same reason: never let an empty state silently
/// overwrite real data).
pub fn integrity_check(conn: &Connection) -> DbResult<Result<(), String>> {
    let result: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if result == "ok" {
        Ok(Ok(()))
    } else {
        Ok(Err(result))
    }
}

/// 기동 시 무결성 판정 (v3.3.9).
///
/// ⚠️ **"검사를 못 했다"와 "검사 결과 손상이다"는 전혀 다르다.** 예전엔 둘 다
/// '손상'으로 처리해 그 세션의 저장·읽기를 통째로 잠갔다. 그래서 앱을 껐다 2~3초
/// 만에 다시 켜면(이전 프로세스가 아직 파일을 쥔 찰나) 검사가 잠금 때문에 오류로
/// 끝나고, 파일은 멀쩡한데도 "저장이 잠겨 있습니다 / 1. 트레이 종료 2. 재실행"
/// 안내가 계속 떴다.
///
/// v3.3.1 이 `open()` 에 대해 배운 것 — **잠금은 손상이 아니라 대기 대상** — 을
/// 검사에도 적용한다: 못 끝내면 몇 번 다시 하고, 그래도 안 되면 손상으로 단정하지
/// 않는다. 진짜 손상은 `Ok(Err(report))` 로 분명히 드러나며 그때만 잠근다.
///
/// 반환: (계속 써도 되는가, 로그에 남길 사연)
pub fn integrity_verdict(conn: &Connection, attempts: u32, delay: std::time::Duration) -> (bool, Option<String>) {
    let mut note = None;
    for attempt in 0..attempts.max(1) {
        match integrity_check(conn) {
            Ok(Ok(())) => return (true, None),
            Ok(Err(report)) => return (false, Some(format!("integrity FAILED: {report}"))),
            Err(e) => {
                eprintln!("DB integrity check errored (attempt {}): {e}", attempt + 1);
                note = Some(format!("integrity check could not run: {e}"));
                if attempt + 1 < attempts.max(1) {
                    std::thread::sleep(delay);
                }
            }
        }
    }
    (true, note) // 검사를 못 끝낸 것은 손상의 근거가 아니다
}

/// Opens `db_path`, recovering automatically instead of ever failing
/// outright:
///   1. Try `db_path` directly.
///   2. If that fails for any reason (corruption, an unreadable file,
///      whatever), try restoring the newest file in `backups_dir` over it
///      and opening that.
///   3. If that also fails (or there are no backups), quarantine whatever
///      is at `db_path` — renamed aside, never deleted — and start fresh.
/// Returns the connection plus a user-facing note describing what happened,
/// if anything did (None on the ordinary happy path). The caller is
/// expected to surface that note prominently (see lib.rs's startup dialog)
/// rather than let a silent recovery hide potential data loss.
pub fn open_with_recovery(
    db_path: &Path,
    backups_dir: &Path,
) -> DbResult<(Connection, Option<String>)> {
    /* v3.3.1: 복구(백업 덮어쓰기)는 **되돌릴 수 없는** 동작이므로, 한 번 실패했다고
       바로 넘어가지 않는다. 종료 직후 재실행처럼 일시적인 잠금·AV 스캔·파일 핸들
       해제 지연은 잠깐 뒤 성공하는 경우가 대부분이다. 짧게 몇 번 다시 열어 보고,
       그래도 안 되는 '진짜' 실패만 복구 경로로 보낸다. */
    let mut primary_err = None;
    for attempt in 0..4 {
        match open(db_path) {
            Ok(conn) => return Ok((conn, None)),
            Err(e) => {
                eprintln!("DB open attempt {} failed: {e}", attempt + 1);
                primary_err = Some(e);
                std::thread::sleep(std::time::Duration::from_millis(400));
            }
        }
    }
    let primary_err = primary_err.expect("loop always records an error before exiting");
    eprintln!(
        "primary DB open failed at {}: {primary_err} — attempting recovery",
        db_path.display()
    );

    /* v3.3.6: 복구에 들어가기 전에 **원본을 반드시 옆에 남긴다.**
       지금까지 복구는 `fs::copy(backup, db_path)` 로 원본을 그 자리에서 덮어썼다.
       그 뒤에 팝업으로 알려 주지만, 그때는 이미 되돌릴 수 없다 — 만약 원본이 사실
       멀쩡했고(일시적 잠금 등) 백업이 옛것이었다면 그 순간 최신 데이터가 사라진다.
       복사 한 번이면 그 위험이 통째로 없어진다: 무슨 일이 있어도 원본은 남는다.
       (파일이 없거나 복사에 실패해도 복구 자체는 계속한다 — 앱은 켜져야 한다.) */
    let mut kept: Option<PathBuf> = None;
    if db_path.exists() {
        let aside = db_path.with_file_name(format!("wmhh.before-recovery-{}.sqlite", fs_stamp()));
        match fs::copy(db_path, &aside) {
            Ok(_) => kept = Some(aside),
            Err(e) => eprintln!("복구 전 원본 보관 실패(복구는 계속): {e}"),
        }
    }
    let kept_note = kept
        .as_ref()
        .map(|p| {
            format!(
                "\n\n복구 전 원본은 지우지 않고 옆에 보관했습니다: {}\n(원본이 사실 멀쩡했다면 이 파일을 [설정] → [JSON·DB파일 불러오기]로 되살릴 수 있습니다.)",
                p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            )
        })
        .unwrap_or_default();

    // Try backups newest-first, but ONLY adopt one that passes its OWN
    // integrity check. A subtly corrupt newest backup must not be restored
    // over an older good one — the manual `.sqlite` import path already
    // probes integrity before staging (see commands::import_backup_file);
    // this makes the automatic recovery path symmetric instead of blindly
    // trusting the newest file.
    for backup in backups_newest_first(backups_dir) {
        if !backup_is_healthy(&backup) {
            eprintln!(
                "backup {} failed its integrity probe — skipping to an older one",
                backup.display()
            );
            continue;
        }
        match fs::copy(&backup, db_path).and_then(|_| open(db_path).map_err(std::io::Error::other))
        {
            Ok(conn) => {
                let note = format!(
                    "원본 데이터베이스 파일을 열 수 없어({primary_err}) 가장 최근의 정상 자동 백업({})으로 복구했습니다.{kept_note}",
                    backup.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                );
                return Ok((conn, Some(note)));
            }
            Err(e) => eprintln!("backup {} restore/open failed: {e}", backup.display()),
        }
    }

    // Quarantine whatever's there (if anything) and start fresh — this must
    // succeed for the app to be usable at all, so it's the one case still
    // allowed to propagate an error up to the caller.
    if db_path.exists() {
        let quarantined = db_path.with_file_name(format!("wmhh.broken-{}.sqlite", fs_stamp()));
        let _ = fs::rename(db_path, &quarantined);
    }
    let conn = open(db_path)?;
    let note = format!(
        "데이터베이스를 열 수 없었고 사용 가능한 자동 백업도 없어 새로 시작합니다.\n\
         (문제가 있던 파일은 삭제하지 않고 옆에 보관해두었습니다.)\n원래 오류: {primary_err}{kept_note}"
    );
    Ok((conn, Some(note)))
}

/// Path used to stage a picked `.sqlite`/`.db` file for
/// `commands::import_backup_file` until it's safe to apply — see
/// `apply_pending_import`.
pub fn pending_import_path(db_path: &Path) -> PathBuf {
    db_path.with_file_name("wmhh.sqlite.pending-import")
}

/// If a staged import exists next to `db_path` (see `pending_import_path`),
/// apply it now: snapshot the current file into `backups_dir`, replace
/// `db_path` with the staged one, and remove the staging file.
///
/// MUST be called before any connection to `db_path` is opened in this
/// process. Importing used to `fs::copy` the picked file directly over
/// `db_path` from inside a running command — but that overwrote the exact
/// file this process's own live connection had open. The raw byte-copy
/// itself "succeeded" every time, but the stale open connection's later
/// teardown then corrupted what had just been written, so every import
/// came back as "couldn't open the original, recovered from backup" on the
/// very next launch. Staging the file and only ever applying it at the
/// start of a *fresh* process — before that process has opened anything —
/// avoids the conflict entirely.
pub fn apply_pending_import(db_path: &Path, backups_dir: &Path) -> DbResult<bool> {
    let pending = pending_import_path(db_path);
    if !pending.exists() {
        return Ok(false);
    }
    if db_path.exists() {
        fs::create_dir_all(backups_dir)?;
        let _ = fs::copy(
            db_path,
            backups_dir.join(format!("wmhh_preimport_{}.sqlite", fs_stamp())),
        );
    }
    if fs::rename(&pending, db_path).is_err() {
        // rename can fail across filesystem boundaries; fall back to copy+remove.
        fs::copy(&pending, db_path)?;
        fs::remove_file(&pending)?;
    }
    Ok(true)
}

/// Extracts the embedded `YYYYMMDD_HHMMSS` timestamp (8 digits, '_', 6 digits)
/// from a backup filename, ignoring the `wmhh_` / `wmhh_preimport_` /
/// `wmhh_prerestore_` prefix. Sorting by THIS (not the raw filename) is what
/// keeps chronological order across mixed prefixes: a raw lexical sort puts
/// every `pre*` file after every regular one (the byte after `wmhh_` is `'p'`
/// (0x70) for pre-files vs a digit `'2'` (0x32) for regular ones, and
/// `'2' < 'p'`), which made recovery restore a stale `prerestore` snapshot and
/// pruning delete recent regular backups (v2.5.11 fix). Files with no stamp
/// fall back to the whole name so ordering stays deterministic.
fn stamp_key(p: &Path) -> String {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = name.as_bytes();
    let mut start = 0usize;
    while start + 15 <= bytes.len() {
        let s = &bytes[start..start + 15];
        if s[..8].iter().all(|b| b.is_ascii_digit())
            && s[8] == b'_'
            && s[9..15].iter().all(|b| b.is_ascii_digit())
        {
            return name[start..start + 15].to_string();
        }
        start += 1;
    }
    name
}

/// All `.sqlite` files in `backups_dir`, newest first by embedded timestamp
/// (NOT filename — mixed prefixes wmhh_/preimport_/prerestore_/presave_ break
/// a raw lexical sort; see stamp_key).
fn backups_newest_first(backups_dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = match fs::read_dir(backups_dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
            .collect(),
        Err(_) => return Vec::new(),
    };
    entries.sort_by(|a, b| stamp_key(b).cmp(&stamp_key(a)));
    entries
}

/// True if `path` opens as SQLite and passes `PRAGMA integrity_check`.
/// Used to vet a backup before adopting it during recovery, so a corrupt
/// snapshot is skipped rather than restored over good data.
fn backup_is_healthy(path: &Path) -> bool {
    Connection::open(path)
        .and_then(|c| c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)))
        .map(|s| s == "ok")
        .unwrap_or(false)
}

/// Filesystem-safe timestamp when no connection is at hand (pre-open code
/// paths). Uses a throwaway in-memory SQLite for strftime so every backup
/// filename shares one format — mixed formats (unix epoch vs YYYYMMDD)
/// both read poorly next to each other and confuse `prune_backups`'s
/// date extraction.
pub fn fs_stamp() -> String {
    Connection::open_in_memory()
        .and_then(|c| {
            c.query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| {
                r.get::<_, String>(0)
            })
        })
        .unwrap_or_else(|_| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                .to_string()
        })
}

/// Filesystem-safe timestamp for naming backup files. Must use 'localtime'
/// like `fs_stamp` does — `newest_backup`/`prune_backups` sort by the embedded
/// `YYYYMMDD_HHMMSS` stamp (see `stamp_key`), so all stamps must share one
/// clock; mixing a UTC stamp with localtime ones would misorder them (an older
/// localtime file could sort after a newer UTC one, so recovery would restore
/// stale data).
pub fn now_stamp(conn: &Connection) -> DbResult<String> {
    Ok(conn.query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))?)
}

/// Copies the live database file into `backups_dir` with a timestamped
/// name, then prunes (see `prune_backups`). This is insurance independent
/// of the manual JSON export — cheap protection against schema bugs or an
/// accidental bulk delete. Unconditional: used for forced snapshots
/// (pre-import/pre-restore); the ordinary after-save path goes through
/// `rotate_backup_throttled` instead.
pub fn rotate_backup(db_path: &Path, backups_dir: &Path, stamp: &str, keep: usize) -> DbResult<()> {
    fs::create_dir_all(backups_dir)?;
    let dest = backups_dir.join(format!("wmhh_{stamp}.sqlite"));
    fs::copy(db_path, &dest)?;
    prune_backups(backups_dir, keep)?;
    Ok(())
}

/// Like `rotate_backup`, but skips (returning false) when the newest
/// existing backup is younger than `min_interval`.
///
/// Without the throttle, every save rotated a backup — and saves fire on
/// every user action, so all `keep` slots filled up within minutes of a
/// single editing session. That makes the rotation useless as protection:
/// by the time you notice bad data, every retained backup already contains
/// it. Throttling spreads the slots across hours/days of real use.
pub fn rotate_backup_throttled(
    db_path: &Path,
    backups_dir: &Path,
    stamp: &str,
    keep: usize,
    min_interval: std::time::Duration,
) -> DbResult<bool> {
    let newest_mtime = fs::read_dir(backups_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|ext| ext == "sqlite").unwrap_or(false)
        })
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
        .max();
    if let Some(mtime) = newest_mtime {
        if let Ok(age) = std::time::SystemTime::now().duration_since(mtime) {
            if age < min_interval {
                return Ok(false);
            }
        }
    }
    rotate_backup(db_path, backups_dir, stamp, keep)?;
    Ok(true)
}

/// Had at least this many rows AND the new set is at most half → force a
/// pre-save safety snapshot. Tuned to ignore routine one/two-item deletions
/// while catching a mass delete or an accidental whole-array truncation
/// (e.g. a frontend bug shipping a partial S.items to save_all).
const SHRINK_SNAPSHOT_FLOOR: i64 = 5;

/// Saves `items` as usual, but when the item count drops drastically (see
/// `SHRINK_SNAPSHOT_FLOOR`) first takes an UNCONDITIONAL timestamped snapshot
/// of the current file *before* the destructive delete+reinsert — so a
/// pre-shrink restore point always exists even if the throttled after-save
/// rotation would have skipped it. Because the whole-dataset save replaces
/// every row, a single bad save could otherwise wipe everything with the
/// most recent auto-backup being <30 min old and already reflecting the loss.
/// Returns whether a snapshot was taken (best-effort — a snapshot failure is
/// logged but never blocks the save itself).
/// `save_items_guarded` 의 결과.
///
/// `Stale` 은 **오류가 아니라 정상적인 거절**이다 — 낡은 화면이 최신 데이터를
/// 덮으려 했고 우리가 막았다는 뜻. 그래서 Err 가 아니라 값으로 돌려준다
/// (프런트가 "저장 실패"로 오해해 재시도하면 안 된다. 같은 낡은 내용을 계속
/// 다시 밀어 넣는 꼴이 된다).
#[derive(Debug, PartialEq, Eq)]
pub enum SaveOutcome {
    /// 저장됨. 새 번호를 돌려주므로 프런트는 이걸 다음 저장에 쓴다.
    Saved { version: i64, snapshotted: bool },
    /// 거절됨. 내가 본 번호(expected)와 지금 DB 번호(current)가 다르다.
    Stale { expected: i64, current: i64 },
}

pub fn save_items_guarded(
    conn: &mut Connection,
    db_path: &Path,
    backups_dir: &Path,
    items: &[model::Item],
    keep: usize,
    expected_version: Option<i64>,
) -> DbResult<SaveOutcome> {
    /* v3.3.4: 세어 보지 못했으면 **스냅샷을 찍는 쪽**으로 기운다. 예전엔
       `unwrap_or(0)` 이라 count 가 실패하면 prev=0 → 조건 불성립 → 보호가 조용히
       꺼졌다. 그런데 count 가 실패하는 상황(잠금·I/O 오류)이야말로 DB 가 불안정해
       스냅샷이 가장 필요한 때다. 안전한 방향은 '못 세었으면 일단 남긴다'이다 —
       잘못 찍힌 스냅샷의 대가는 백업 파일 하나뿐이고, 안 찍힌 대가는 데이터다. */
    /* 번호표 확인이 먼저다(v3.3.7). 거절할 저장이면 스냅샷도 백업도 만들 이유가 없다 —
       낡은 화면의 저장은 흔한 일(창을 오래 띄워둔 것만으로도 생긴다)이므로 조용히 돌려보낸다.
       ⚠️ 여기서 한 번, 아래 트랜잭션 안에서 또 한 번 확인한다. 이 확인은 '값싼 조기 거절'이고
       진짜 판정은 트랜잭션 안의 것이다 — 둘 사이에 다른 저장이 끼어들 수 있기 때문. */
    if let Some(expected) = expected_version {
        let current = self::meta::read_version(conn)?;
        if expected != current {
            return Ok(SaveOutcome::Stale { expected, current });
        }
    }

    let prev: Option<i64> = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .map_err(|e| eprintln!("item count before save failed ({e}) — 보수적으로 스냅샷을 남긴다"))
        .ok();
    let new = items.len() as i64;
    let mut snapshotted = false;
    let drastic_shrink = match prev {
        Some(prev) => prev >= SHRINK_SNAPSHOT_FLOOR && new <= prev / 2,
        None => true,
    };
    if drastic_shrink {
        match now_stamp(conn).and_then(|stamp| {
            rotate_backup(db_path, backups_dir, &format!("presave_{stamp}"), keep)
        }) {
            Ok(()) => snapshotted = true,
            Err(e) => eprintln!("pre-save safety snapshot failed (saving anyway): {e}"),
        }
    }
    /* 확인과 쓰기와 번호 올리기가 **한 트랜잭션**이어야 한다. 따로 하면 그 사이 다른
       저장이 끼어들어, 둘 다 "내 번호가 맞다"고 통과한 뒤 나중 것이 앞 것을 덮는다. */
    let tx = conn.transaction()?;
    let current = self::meta::read_version_tx(&tx)?;
    if let Some(expected) = expected_version {
        if expected != current {
            return Ok(SaveOutcome::Stale { expected, current }); // tx 는 drop 되며 롤백
        }
    }
    self::items::save_items_tx(&tx, items)?;
    let version = self::meta::bump_version_tx(&tx)?;
    tx.commit()?;
    Ok(SaveOutcome::Saved { version, snapshotted })
}

/// Deletes old backups, keeping (a) the newest `keep` files and (b) the
/// FIRST backup of each calendar day for the 14 most recent days seen.
/// (b) is what makes the rotation meaningful over time: even during a
/// heavy editing session that churns through all `keep` recent slots, a
/// start-of-day restore point per day survives for two weeks.
fn prune_backups(backups_dir: &Path, keep: usize) -> DbResult<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(backups_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
        .collect();
    // Sort by embedded timestamp, NOT filename (mixed prefixes break lexical order — see stamp_key).
    entries.sort_by(|a, b| stamp_key(a).cmp(&stamp_key(b)));

    // First file per parsed YYYYMMDD date, for the newest 14 distinct dates.
    let date_of = |p: &Path| -> Option<String> {
        let name = p.file_name()?.to_string_lossy().into_owned();
        let bytes = name.as_bytes();
        let mut run_start = None;
        for (i, b) in bytes.iter().enumerate() {
            if b.is_ascii_digit() {
                let start = *run_start.get_or_insert(i);
                if i - start + 1 == 8 {
                    return Some(name[start..=i].to_string());
                }
            } else {
                run_start = None;
            }
        }
        None
    };
    let mut first_of_day: std::collections::BTreeMap<String, PathBuf> = Default::default();
    for p in &entries {
        if let Some(d) = date_of(p) {
            first_of_day.entry(d).or_insert_with(|| p.clone());
        }
    }
    let protected: std::collections::HashSet<PathBuf> = first_of_day
        .into_iter()
        .rev() // newest dates first
        .take(14)
        .map(|(_, p)| p)
        .collect();

    if entries.len() > keep {
        let cutoff = entries.len() - keep;
        for old in &entries[..cutoff] {
            if !protected.contains(old) {
                let _ = fs::remove_file(old);
            }
        }
    }
    Ok(())
}

/// Applies a relocation staged by `commands::choose_data_dir`: copies the
/// database, any staged import, and all backups from `old_base` into
/// `new_base`. MUST run before anything in this process opens the DB.
/// The copy deliberately happens here (next launch) rather than at choose
/// time so that edits made between choosing a new location and actually
/// restarting are carried over instead of silently left behind.
pub fn apply_pending_move(old_base: &Path, new_base: &Path) -> DbResult<()> {
    let old_db = old_base.join("data").join("wmhh.sqlite");
    let new_data = new_base.join("data");
    fs::create_dir_all(&new_data)?;
    if old_db.exists() {
        fs::copy(&old_db, new_data.join("wmhh.sqlite"))?;
    }
    let old_pending = pending_import_path(&old_db);
    if old_pending.exists() {
        fs::copy(&old_pending, pending_import_path(&new_data.join("wmhh.sqlite")))?;
        let _ = fs::remove_file(&old_pending);
    }
    let old_backups = old_base.join("backups");
    let new_backups = new_base.join("backups");
    fs::create_dir_all(&new_backups)?;
    if old_backups.is_dir() {
        for entry in fs::read_dir(&old_backups)?.filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                let _ = fs::copy(entry.path(), new_backups.join(entry.file_name()));
            }
        }
    }
    Ok(())
}
