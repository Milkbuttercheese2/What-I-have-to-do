//! 문서 폴더 감시 — 앱 밖(탐색기 등)에서 **이름을 바꾼 것만** 알아채 화면에 알린다.
//!
//! - 하위 항목: `ReadDirectoryChangesW` 의 '옛 이름 → 새 이름' 한 쌍만 따른다. 지우기·새로 만들기·다른 폴더로 옮기기
//!   (탐색기는 이것을 지움+만듦으로 알린다)는 따르지 않는다 — 링크를 엉뚱하게 바꾸지 않기 위해 **확실한 이름 바뀜만**.
//! - 오피스 '안전 저장'은 `원본 → 임시 이름`, `새 내용 → 원본` 처럼 이름 바꾸기 두 번이다. 그대로 따르면 업무 링크가
//!   임시 파일로 가 버린다. 그래서 바뀜을 `SETTLE` 만큼 묵혔다가 **옛 경로가 비어 있고 새 경로가 있을 때만** 내보내고,
//!   그 사이 옛 이름이 다시 생기면(새 이름으로 들어오거나 새로 만들어지면) 버린다. `~`·`.tmp` 이름도 따르지 않는다.
//! - 문서 폴더 자체: 감시 핸들이 가리키는 폴더의 **지금 경로**(`GetFinalPathNameByHandleW`)를 주기적으로 본다.
//!   이름이 바뀌면(위 폴더 이름이 바뀐 경우도) 핸들은 같은 폴더를 계속 가리키므로 새 경로가 확실하다. 휴지통으로 간 것은 따르지 않는다.
//! - 핸들은 FILE_SHARE_DELETE 로 연다 — 감시 때문에 사용자가 폴더 이름을 못 바꾸는 일이 없게.
//! - 그 밖의 바뀜(만들기·지우기·옮기기·복사·내용 고침)은 `Batch` 로 모아 `Changed`(목록이 바뀐 폴더들·내용이 바뀐 파일들)
//!   하나로 알린다 — 압축 풀기·대량 복사 때 알림이 수천 개 와도 화면은 묶음 하나씩만 다시 그린다. 알림이 넘치면(공유 폴더 등)
//!   `overflow` 로 '이 폴더 전체를 다시 읽어라'. 업무 링크는 여기서 건드리지 않는다(확실한 이름 바뀜만 `Renamed`).
//! - 문서 폴더가 지워지거나(휴지통 포함) 열 수 없게 되면 `RootGone` 하나를 보내고 감시를 끝낸다(핸들을 놓아 지우기가 끝나게).
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 이름 바뀜을 묵히는 시간 — 오피스 저장 춤(이름 두 번 바꾸기 + 지우기)이 끝나기를 기다린다
pub const SETTLE: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, PartialEq)]
pub enum Ev {
    /// 문서 폴더 `root`(정규화한 보기 경로 `base`) 안에서 `from` → `to`('/' 구분 상대 경로)
    Renamed { root: usize, base: String, from: String, to: String },
    /// 문서 폴더 자체가 `base` → `to` 로 (보기 경로)
    RootMoved { root: usize, base: String, to: String },
    /// 목록이 바뀐 폴더들(`dirs`, '' = 문서 폴더 맨 위)·바뀐(생김·없어짐·내용) 항목들(`paths`) — `overflow` 면 그 문서 폴더 전체
    Changed { root: usize, base: String, dirs: Vec<String>, paths: Vec<String>, overflow: bool },
    /// 문서 폴더가 없어졌다(지움·휴지통·열 수 없음)
    RootGone { root: usize, base: String },
}
pub type Sink = Arc<dyn Fn(Ev) + Send + Sync>;

const ADDED: u32 = 1;
const MODIFIED: u32 = 3;
const OLD_NAME: u32 = 4;
const NEW_NAME: u32 = 5;

/// FILE_NOTIFY_INFORMATION 목록 → (동작, '/' 구분 상대 이름)
pub fn parse_notify(buf: &[u8]) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    let mut off = 0usize;
    let rd = |o: usize| -> Option<u32> { buf.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])) };
    loop {
        let (Some(next), Some(action), Some(len)) = (rd(off), rd(off + 4), rd(off + 8)) else { break };
        let s = off + 12;
        let Some(nb) = buf.get(s..s + len as usize) else { break };
        let w: Vec<u16> = nb.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        out.push((action, String::from_utf16_lossy(&w).replace('\\', "/")));
        if next == 0 { break; }
        off += next as usize;
    }
    out
}

fn temp_like(rel: &str) -> bool {
    let n = rel.rsplit('/').next().unwrap_or(rel).to_lowercase();
    n.starts_with('~') || n.ends_with(".tmp")
}
fn same(a: &str, b: &str) -> bool { a.to_lowercase() == b.to_lowercase() }

/// 이름 바뀜 쌍 맞추기·묵히기(운영체제와 무관한 순수 부분 — 시험 대상)
#[derive(Default)]
pub struct Tracker {
    old: Option<String>,
    pending: Vec<(String, String, Instant)>,
}
impl Tracker {
    pub fn feed(&mut self, action: u32, name: String, now: Instant) {
        match action {
            OLD_NAME => self.old = Some(name),
            NEW_NAME => {
                let Some(o) = self.old.take() else { return };
                /* 무언가가 기다리던 바뀜의 옛 이름으로 들어왔다 = 안전 저장(원본 자리를 새 파일이 채움) → 그 바뀜은 이름 바꾸기가 아니다 */
                self.pending.retain(|p| !same(&p.0, &name));
                /* A→B 다음 B→C 는 A→C 하나로(그 사이 저장된 적 없음) */
                if let Some(p) = self.pending.iter_mut().find(|p| same(&p.1, &o)) {
                    p.1 = name; p.2 = now;
                } else {
                    self.pending.push((o, name, now));
                }
                self.pending.retain(|p| p.0 != p.1);
            }
            _ => {
                self.old = None;
                if action == ADDED { self.pending.retain(|p| !same(&p.0, &name)); }   // 옛 자리에 새로 만들어졌다
            }
        }
    }
    /// 충분히 묵은 바뀜을 순서대로 꺼낸다(앞 것이 덜 묵었으면 뒤 것도 기다린다 — 순서가 곧 의미).
    /// `exists(rel)` 로 디스크를 확인: 옛 경로가 비고 새 경로가 있어야 확실한 이름 바뀜이다(대소문자만 바꾼 것은 새 경로만 본다).
    pub fn due(&mut self, now: Instant, exists: impl Fn(&str) -> bool) -> Vec<(String, String)> {
        let mut out = Vec::new();
        while let Some(p) = self.pending.first() {
            if now.duration_since(p.2) < SETTLE { break; }
            let (from, to, _) = self.pending.remove(0);
            if temp_like(&from) || temp_like(&to) { continue; }
            if !exists(&to) { continue; }
            if !same(&from, &to) && exists(&from) { continue; }
            out.push((from, to));
        }
        out
    }
}

/// 바뀜 묶기 — 마지막 바뀜 뒤 `QUIET` 동안 조용하거나, 첫 바뀜부터 `MAX_WAIT` 가 지나면 한 번에 내보낸다
pub const QUIET: Duration = Duration::from_millis(300);
pub const MAX_WAIT: Duration = Duration::from_millis(1000);
/// 한 묶음에 폴더가 이보다 많으면 하나하나 알리지 않고 '전체 다시 읽기'
pub const MAX_DIRS: usize = 200;
/// 문서 폴더가 이만큼 계속 없어야 없어졌다고 알린다
pub const GONE_WAIT: Duration = Duration::from_millis(1000);
const MAX_PATHS: usize = 2000;

#[derive(Default, Debug, PartialEq)]
pub struct Batch {
    pub dirs: std::collections::BTreeSet<String>,
    pub paths: std::collections::BTreeSet<String>,
    pub overflow: bool,
    first: Option<Instant>,
    last: Option<Instant>,
}
fn parent_rel(rel: &str) -> String { rel.rfind('/').map(|k| rel[..k].to_string()).unwrap_or_default() }
impl Batch {
    pub fn feed(&mut self, action: u32, name: &str, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
        if self.overflow { return; }
        self.paths.insert(name.to_string());
        if action != MODIFIED {
            self.dirs.insert(parent_rel(name));
            if action == OLD_NAME || action == 2 { self.dirs.insert(name.to_string()); }   // 없어진 폴더라면 그 안 목록도 버려야 한다
        }
        if self.dirs.len() > MAX_DIRS || self.paths.len() > MAX_PATHS { self.set_overflow(now); }
    }
    pub fn set_overflow(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
        self.overflow = true;
        self.dirs.clear();
        self.paths.clear();
    }
    /// 내보낼 때가 됐으면 (dirs, files, overflow) 를 꺼내고 비운다
    pub fn take(&mut self, now: Instant) -> Option<(Vec<String>, Vec<String>, bool)> {
        let (Some(f), Some(l)) = (self.first, self.last) else { return None };
        if now.duration_since(l) < QUIET && now.duration_since(f) < MAX_WAIT { return None; }
        let out = (std::mem::take(&mut self.dirs).into_iter().collect(), std::mem::take(&mut self.paths).into_iter().collect(), self.overflow);
        *self = Batch::default();
        Some(out)
    }
}

/// 보기 경로(`\\?\` 떼기, 공유 폴더는 `\\서버\…`)
pub fn display(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") { return format!(r"\\{rest}"); }
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or_else(|| s.to_string())
}
fn in_recycle_bin(s: &str) -> bool { s.to_lowercase().contains(r"\$recycle.bin\") }

/// 지금 돌고 있는 감시들의 멈춤 깃발 — `start` 가 새로 잡을 때 앞의 것을 모두 멈춘다
static STOPS: Mutex<Vec<Arc<AtomicBool>>> = Mutex::new(Vec::new());

/// 문서 폴더들(정규화된 경로, 폴더 번호 순서) 감시를 새로 시작한다. 못 연 폴더(None)는 건너뛴다.
pub fn start(roots: Vec<Option<PathBuf>>, sink: Sink) {
    let mut stops = STOPS.lock().unwrap_or_else(|e| e.into_inner());
    for s in stops.drain(..) { s.store(true, Ordering::SeqCst); }
    for (i, r) in roots.into_iter().enumerate() {
        let Some(r) = r else { continue };
        let stop = Arc::new(AtomicBool::new(false));
        stops.push(stop.clone());
        let sink = sink.clone();
        let _ = std::thread::Builder::new().name(format!("docwatch-{i}")).spawn(move || {
            if let Err(e) = imp::watch(i, &r, &stop, &sink) { eprintln!("문서 폴더 감시 실패({i}): {e}"); }
        });
    }
}
/// 지금 알림을 받고 있는 문서 폴더들(v3.8.25) — 찾기 색인이 '감시가 살아 있으면 30초마다 다시 훑지 않는다'를 정할 때 본다.
/// 감시를 건 뒤(첫 ReadDirectoryChangesW 성공) 넣고, 감시가 끝나면(멈춤·폴더 없어짐·오류) 뺀다. 같은 폴더를 잠깐 두 감시가
/// 겹쳐 볼 수 있어(폴더를 다시 정할 때) 하나씩 넣고 하나씩 뺀다.
static LIVE: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
pub fn is_live(base: &Path) -> bool { LIVE.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|p| p == base) }
#[allow(dead_code)]
struct LiveMark(Option<PathBuf>);
#[allow(dead_code)]
impl LiveMark {
    fn set(&mut self, p: &Path) {
        if self.0.is_none() { LIVE.lock().unwrap_or_else(|e| e.into_inner()).push(p.to_path_buf()); self.0 = Some(p.to_path_buf()); }
    }
}
impl Drop for LiveMark {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let mut l = LIVE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(k) = l.iter().position(|x| *x == p) { l.remove(k); }
        }
    }
}

/// 모든 감시를 멈춘다(시험용)
#[allow(dead_code)]
pub fn stop_all() {
    for s in STOPS.lock().unwrap_or_else(|e| e.into_inner()).drain(..) { s.store(true, Ordering::SeqCst); }
}

fn exists_under(base: &Path, rel: &str) -> bool {
    std::fs::symlink_metadata(base.join(rel.replace('/', "\\"))).is_ok()
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetFinalPathNameByHandleW, ReadDirectoryChangesW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED,
        FILE_LIST_DIRECTORY, FILE_NAME_NORMALIZED, FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
    use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

    struct Handles { dir: HANDLE, ev: HANDLE }
    impl Drop for Handles {
        fn drop(&mut self) { unsafe { let _ = CloseHandle(self.dir); let _ = CloseHandle(self.ev); } }
    }

    fn final_path(h: HANDLE) -> Option<String> {
        let mut buf = vec![0u16; 1024];
        let n = unsafe { GetFinalPathNameByHandleW(h, &mut buf, FILE_NAME_NORMALIZED) } as usize;
        if n == 0 || n > buf.len() { return None; }
        Some(String::from_utf16_lossy(&buf[..n]))
    }

    pub fn watch(i: usize, root: &Path, stop: &AtomicBool, sink: &Sink) -> Result<(), String> {
        let dir = unsafe {
            CreateFileW(&HSTRING::from(root.as_os_str()), FILE_LIST_DIRECTORY.0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED, None)
        }.map_err(|e| e.to_string())?;
        let ev = match unsafe { CreateEventW(None, true, false, None) } {
            Ok(ev) => ev,
            Err(e) => { unsafe { let _ = CloseHandle(dir); } return Err(e.to_string()); }
        };
        let h = Handles { dir, ev };
        let mut cur = final_path(h.dir).ok_or("폴더 경로를 알 수 없습니다")?;
        let mut buf = vec![0u32; 16 * 1024];             // 64KB — 공유 폴더 상한, DWORD 정렬
        let mut tr = Tracker::default();
        let mut batch = Batch::default();
        let mut gone_since: Option<Instant> = None;
        let mut ov = OVERLAPPED::default();
        let mut armed = false;
        let mut live = LiveMark(None);
        let filter = FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_SIZE;
        while !stop.load(Ordering::SeqCst) {
            if !armed && gone_since.is_none() {
                ov = OVERLAPPED { hEvent: h.ev, ..Default::default() };
                let r = unsafe { ReadDirectoryChangesW(h.dir, buf.as_mut_ptr().cast(), (buf.len() * 4) as u32, true, filter, None, Some(&mut ov), None) };
                match r {
                    Ok(()) => { armed = true; live.set(root); }
                    // 지워지는 중인 폴더 등 — 아래 '없어졌나' 확인이 맡는다. 폴더가 멀쩡한데 못 거는 것이면 감시를 접는다
                    Err(e) => { if Path::new(&cur).is_dir() { return Err(e.to_string()); } gone_since = Some(Instant::now()); }
                }
            }
            if armed && unsafe { WaitForSingleObject(h.ev, 300) } == WAIT_OBJECT_0 {
                armed = false;
                let mut n = 0u32;
                let now = Instant::now();
                if unsafe { GetOverlappedResult(h.dir, &ov, &mut n, false) }.is_ok() && n > 0 {
                    let bytes = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), n as usize) };
                    for (a, name) in parse_notify(bytes) { batch.feed(a, &name, now); tr.feed(a, name, now); }
                } else {
                    // 넘침(n == 0 · ERROR_NOTIFY_ENUM_DIR) — 그 사이 바뀜은 모른다: 이름 바뀜은 따르지 않고 폴더 전체를 다시 읽게
                    tr = Tracker::default();
                    batch.set_overflow(now);
                }
            } else if !armed {
                std::thread::sleep(Duration::from_millis(300));
            }
            /* 문서 폴더 자체(또는 위 폴더)의 이름이 바뀌었나 · 없어졌나 */
            let now_path = final_path(h.dir);
            let gone = match &now_path { Some(p) => in_recycle_bin(p) || !Path::new(p).is_dir(), None => !Path::new(&cur).is_dir() };
            if gone {
                let t = *gone_since.get_or_insert_with(Instant::now);
                if t.elapsed() >= GONE_WAIT {           // 잠깐 끊긴 공유 폴더를 없어졌다고 하지 않게 조금 기다린다
                    sink(Ev::RootGone { root: i, base: display(&cur) });
                    break;
                }
                continue;
            }
            gone_since = None;
            if let Some(now_path) = now_path {
                if now_path != cur {
                    let old = cur.clone();
                    cur = now_path.clone();
                    if !Path::new(&old).exists() {
                        sink(Ev::RootMoved { root: i, base: display(&old), to: display(&now_path) });
                    }
                }
            }
            let now = Instant::now();
            if let Some((dirs, paths, overflow)) = batch.take(now) {
                sink(Ev::Changed { root: i, base: display(&cur), dirs, paths, overflow });
            }
            let base = PathBuf::from(&cur);
            for (from, to) in tr.due(now, |rel| exists_under(&base, rel)) {
                sink(Ev::Renamed { root: i, base: display(&cur), from, to });
            }
        }
        if armed {
            unsafe {
                let _ = CancelIoEx(h.dir, Some(&ov));
                let mut n = 0u32;
                let _ = GetOverlappedResult(h.dir, &ov, &mut n, true);   // 취소가 끝나기 전에 버퍼를 놓으면 안 된다
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn watch(_i: usize, _root: &Path, _stop: &AtomicBool, _sink: &Sink) -> Result<(), String> { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(action: u32, name: &str, last: bool) -> Vec<u8> {
        let w: Vec<u16> = name.encode_utf16().collect();
        let mut len = 12 + w.len() * 2;
        len = (len + 3) & !3;
        let mut v = Vec::new();
        v.extend((if last { 0u32 } else { len as u32 }).to_le_bytes());
        v.extend(action.to_le_bytes());
        v.extend(((w.len() * 2) as u32).to_le_bytes());
        for c in w { v.extend(c.to_le_bytes()); }
        v.resize(len, 0);
        v
    }

    #[test]
    fn parses_notify_records() {
        let mut b = rec(OLD_NAME, "가 폴더\\옛.txt", false);
        b.extend(rec(NEW_NAME, "가 폴더\\새.txt", true));
        assert_eq!(parse_notify(&b), vec![(OLD_NAME, "가 폴더/옛.txt".to_string()), (NEW_NAME, "가 폴더/새.txt".to_string())]);
        assert!(parse_notify(&[]).is_empty());
        assert!(parse_notify(&[1, 2, 3]).is_empty());      // 잘린 버퍼에서 터지지 않는다
    }

    #[test]
    fn follows_plain_rename_after_settle() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "B".into(), t0);
        let disk = |r: &str| r == "B";
        assert!(tr.due(t0, disk).is_empty(), "묵히기 전에는 내보내지 않는다");
        assert_eq!(tr.due(t0 + SETTLE, disk), vec![("A".into(), "B".into())]);
        assert!(tr.due(t0 + SETTLE * 2, disk).is_empty());
    }

    #[test]
    fn ignores_delete_create_and_unpaired() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.feed(2, "A".into(), t0);            // 지움
        tr.feed(ADDED, "B".into(), t0);        // 만듦 — 지움+만듦은 이름 바뀜이 아니다
        tr.feed(NEW_NAME, "C".into(), t0);     // 짝 없는 새 이름
        tr.feed(OLD_NAME, "D".into(), t0);
        tr.feed(2, "D".into(), t0);            // 옛 이름 뒤에 다른 일 — 짝이 깨진다
        tr.feed(NEW_NAME, "E".into(), t0);
        assert!(tr.due(t0 + SETTLE, |_| true).is_empty());
    }

    #[test]
    fn office_safe_save_is_not_a_rename() {
        // 워드: 원본 → ~WRL0001.tmp, ~WRD0000.tmp → 원본, ~WRL0001.tmp 지움
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.feed(ADDED, "보고서/~WRD0000.tmp".into(), t0);
        tr.feed(OLD_NAME, "보고서/계획.docx".into(), t0);
        tr.feed(NEW_NAME, "보고서/~WRL0001.tmp".into(), t0);
        tr.feed(OLD_NAME, "보고서/~WRD0000.tmp".into(), t0);
        tr.feed(NEW_NAME, "보고서/계획.docx".into(), t0);
        tr.feed(2, "보고서/~WRL0001.tmp".into(), t0);
        assert!(tr.due(t0 + SETTLE, |_| true).is_empty());
        // 엑셀: 원본 → 확장자 없는 임시 이름, 새 내용 → 원본 — 임시 이름 꼴이 아니어도 옛 자리가 다시 차서 버린다
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "표.xlsx".into(), t0);
        tr.feed(NEW_NAME, "1A2B3C4D".into(), t0);
        tr.feed(OLD_NAME, "5E6F7A8B".into(), t0);
        tr.feed(NEW_NAME, "표.xlsx".into(), t0);
        assert!(tr.due(t0 + SETTLE, |_| true).is_empty());
        // 옛 자리에 새로 만들어진 경우도
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "메모.txt".into(), t0);
        tr.feed(NEW_NAME, "메모.bak".into(), t0);
        tr.feed(ADDED, "메모.txt".into(), t0);
        assert!(tr.due(t0 + SETTLE, |_| true).is_empty());
    }

    #[test]
    fn checks_disk_and_temp_names() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "B".into(), t0);
        assert!(tr.due(t0 + SETTLE, |r| r == "A" || r == "B").is_empty(), "옛 경로가 아직 있으면 따르지 않는다");
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "B".into(), t0);
        assert!(tr.due(t0 + SETTLE, |_| false).is_empty(), "새 경로가 없으면 따르지 않는다");
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "~A.tmp".into(), t0);
        assert!(tr.due(t0 + SETTLE, |r| r == "~A.tmp").is_empty());
        tr.feed(OLD_NAME, "abc".into(), t0);
        tr.feed(NEW_NAME, "ABC".into(), t0);   // 대소문자만 — Windows 에선 옛 경로도 '있다'고 나온다
        assert_eq!(tr.due(t0 + SETTLE, |_| true), vec![("abc".into(), "ABC".into())]);
    }

    #[test]
    fn chains_and_keeps_order() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "B".into(), t0);
        tr.feed(OLD_NAME, "B/c".into(), t0);
        tr.feed(NEW_NAME, "B/d".into(), t0);
        let t1 = t0 + Duration::from_millis(1000);
        tr.feed(OLD_NAME, "B".into(), t1);
        tr.feed(NEW_NAME, "C".into(), t1);      // A→B→C = A→C (묵히기 다시 시작)
        let disk = |r: &str| r == "C" || r == "B/d";
        assert!(tr.due(t0 + SETTLE, disk).is_empty(), "앞 것이 덜 묵었으면 뒤 것도 기다린다");
        assert_eq!(tr.due(t1 + SETTLE, disk), vec![("A".into(), "C".into()), ("B/c".into(), "B/d".into())]);
        let mut tr = Tracker::default();
        tr.feed(OLD_NAME, "A".into(), t0);
        tr.feed(NEW_NAME, "B".into(), t0);
        tr.feed(OLD_NAME, "B".into(), t0);
        tr.feed(NEW_NAME, "A".into(), t0);      // 되돌림 — 아무 일도 없었다
        assert!(tr.due(t0 + SETTLE, |_| true).is_empty());
    }

    #[test]
    fn display_and_bin() {
        assert_eq!(display(r"\\?\C:\업무\가"), r"C:\업무\가");
        assert_eq!(display(r"\\?\UNC\srv\share\가"), r"\\srv\share\가");
        assert!(in_recycle_bin(r"\\?\C:\$Recycle.Bin\S-1-5\$R1234"));
        assert!(!in_recycle_bin(r"\\?\C:\업무\가"));
    }

    #[test]
    fn batch_groups_changes_and_overflows() {
        let t0 = Instant::now();
        let mut b = Batch::default();
        assert!(b.take(t0).is_none());
        b.feed(ADDED, "가/새.txt", t0);
        b.feed(2, "나/옛 폴더", t0);
        b.feed(MODIFIED, "가/d.txt", t0);
        b.feed(OLD_NAME, "x.txt", t0);
        b.feed(NEW_NAME, "y.txt", t0);
        assert!(b.take(t0 + QUIET / 2).is_none(), "조용해질 때까지 모은다");
        let (dirs, paths, of) = b.take(t0 + QUIET).unwrap();
        assert_eq!(dirs, vec!["".to_string(), "x.txt".into(), "가".into(), "나".into(), "나/옛 폴더".into()]);
        assert_eq!(paths, vec!["x.txt".to_string(), "y.txt".into(), "가/d.txt".into(), "가/새.txt".into(), "나/옛 폴더".into()]);
        assert!(!of);
        assert!(b.take(t0 + QUIET * 3).is_none(), "꺼낸 뒤엔 비어 있다");
        // 쉬지 않고 계속 바뀌어도 MAX_WAIT 마다 한 번은 내보낸다
        let mut b = Batch::default();
        let mut t = t0;
        while t < t0 + MAX_WAIT { b.feed(ADDED, "f.txt", t); t += Duration::from_millis(100); }
        assert!(b.take(t).is_some());
        // 폴더가 너무 많으면 '전체 다시 읽기' 하나로
        let mut b = Batch::default();
        for k in 0..=MAX_DIRS { b.feed(ADDED, &format!("d{k}/f.txt"), t0); }
        let (dirs, paths, of) = b.take(t0 + QUIET).unwrap();
        assert!(of && dirs.is_empty() && paths.is_empty());
    }

    /// 실제 Windows 폴더에서 감시를 돌려 알림을 모은다
    #[cfg(windows)]
    struct Probe { rx: std::sync::mpsc::Receiver<Ev>, stop: Arc<AtomicBool>, th: Option<std::thread::JoinHandle<()>> }
    #[cfg(windows)]
    impl Probe {
        fn start(root: &Path) -> Probe {
            let (tx, rx) = std::sync::mpsc::channel::<Ev>();
            let tx = Mutex::new(tx);
            let stop = Arc::new(AtomicBool::new(false));
            let st = stop.clone();
            let root = std::fs::canonicalize(root).unwrap();
            let th = std::thread::spawn(move || {
                let sink: Sink = Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); });
                imp::watch(0, &root, &st, &sink).unwrap();
            });
            std::thread::sleep(Duration::from_millis(400));
            Probe { rx, stop, th: Some(th) }
        }
        /// `until` 가 참이 되는 알림이 올 때까지(최대 secs) 모은다
        fn collect(&self, secs: u64, until: impl Fn(&Ev) -> bool) -> Vec<Ev> {
            let t = Instant::now();
            let mut out = Vec::new();
            while t.elapsed() < Duration::from_secs(secs) {
                if let Ok(e) = self.rx.recv_timeout(Duration::from_millis(200)) {
                    let done = until(&e);
                    out.push(e);
                    if done { break; }
                }
            }
            out
        }
    }
    #[cfg(windows)]
    impl Drop for Probe {
        fn drop(&mut self) { self.stop.store(true, Ordering::SeqCst); if let Some(t) = self.th.take() { let _ = t.join(); } }
    }
    /// v3.8.25 감시가 걸려 있는 동안만 '살아 있음' — 찾기 색인이 30초마다 다시 훑을지 정할 때 본다
    #[cfg(windows)]
    #[test]
    fn live_while_watching_only() {
        let d = std::env::temp_dir().join(format!("wmhh_watch_live_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let root = std::fs::canonicalize(&d).unwrap();
        assert!(!is_live(&root));
        let pr = Probe::start(&d);
        assert!(is_live(&root), "감시를 걸면 살아 있다");
        drop(pr);
        assert!(!is_live(&root), "감시가 끝나면 빠진다");
        let _ = std::fs::remove_dir_all(&d);
    }
    #[cfg(windows)]
    fn changed(evs: &[Ev]) -> (std::collections::BTreeSet<String>, std::collections::BTreeSet<String>) {
        let (mut d, mut p) = (std::collections::BTreeSet::new(), std::collections::BTreeSet::new());
        for e in evs { if let Ev::Changed { dirs, paths, .. } = e { d.extend(dirs.iter().cloned()); p.extend(paths.iter().cloned()); } }
        (d, p)
    }
    #[cfg(windows)]
    fn renames(evs: &[Ev]) -> Vec<(String, String)> {
        evs.iter().filter_map(|e| if let Ev::Renamed { from, to, .. } = e { Some((from.clone(), to.clone())) } else { None }).collect()
    }

    /// 탐색기와 같은 이름 바꾸기(MoveFile)를 알아채는가, 문서 폴더 자체 이름 바꾸기도
    #[cfg(windows)]
    #[test]
    fn watches_real_folder() {
        let top = std::env::temp_dir().join(format!("wmhh_watch_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        let d = top.join("문서");
        std::fs::create_dir_all(d.join("옛 폴더")).unwrap();
        std::fs::write(d.join("옛 폴더/보고서.txt"), b"x").unwrap();
        std::fs::write(d.join("지울것.txt"), b"x").unwrap();
        let pr = Probe::start(&d);
        std::fs::rename(d.join("옛 폴더"), d.join("새 폴더")).unwrap();
        std::fs::remove_file(d.join("지울것.txt")).unwrap();
        std::fs::write(d.join("만든것.txt"), b"x").unwrap();
        let evs = pr.collect(6, |e| matches!(e, Ev::Renamed { .. }));
        assert_eq!(renames(&evs), vec![("옛 폴더".to_string(), "새 폴더".to_string())]);
        let (dirs, paths) = changed(&evs);
        assert!(dirs.contains(""), "{dirs:?}");
        assert!(paths.contains("지울것.txt") && paths.contains("만든것.txt"), "{paths:?}");
        // 문서 폴더 자체 — 감시 중에도 이름을 바꿀 수 있어야 한다(FILE_SHARE_DELETE)
        std::fs::rename(&d, top.join("바뀐 문서")).expect("감시 중인 폴더 이름 바꾸기");
        let evs = pr.collect(6, |e| matches!(e, Ev::RootMoved { .. }));
        match evs.iter().find(|e| matches!(e, Ev::RootMoved { .. })) {
            Some(Ev::RootMoved { root, base, to }) => {
                assert_eq!(*root, 0);
                assert!(base.ends_with("문서"), "{base}");
                assert!(to.ends_with("바뀐 문서"), "{to}");
            }
            _ => panic!("문서 폴더 이름 바뀜 알림이 없다 {evs:?}"),
        }
        let evs = pr.collect(3, |_| false);
        assert!(renames(&evs).is_empty(), "지우기·만들기는 이름 바뀜으로 알리지 않는다 {evs:?}");
        drop(pr);
        let _ = std::fs::remove_dir_all(&top);
    }

    /// 탐색기에서 하는 그 밖의 일 — 만들기·지우기·같은 폴더 안 옮기기·밖으로 옮기기·복사해 넣기·내용 고치기, 그리고 문서 폴더 지우기
    #[cfg(windows)]
    #[test]
    fn reports_other_external_changes() {
        let top = std::env::temp_dir().join(format!("wmhh_watch2_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        let d = top.join("문서");
        for f in ["가/a.txt", "가/b.txt", "가/c.txt", "가/d.txt"] {
            std::fs::create_dir_all(d.join(f).parent().unwrap()).unwrap();
            std::fs::write(d.join(f), b"x").unwrap();
        }
        std::fs::create_dir_all(d.join("나")).unwrap();
        std::fs::create_dir_all(top.join("밖")).unwrap();
        std::fs::write(top.join("밖/원본.txt"), b"copy me").unwrap();
        let pr = Probe::start(&d);
        std::fs::write(d.join("가/새.txt"), b"new").unwrap();
        std::fs::remove_file(d.join("가/a.txt")).unwrap();
        std::fs::rename(d.join("가/b.txt"), d.join("나/b.txt")).unwrap();        // 같은 문서 폴더 안 다른 폴더로
        std::fs::rename(d.join("가/c.txt"), top.join("밖/c.txt")).unwrap();      // 문서 폴더 밖으로
        std::fs::copy(top.join("밖/원본.txt"), d.join("나/복사본.txt")).unwrap();
        { use std::io::Write; let mut f = std::fs::OpenOptions::new().append(true).open(d.join("가/d.txt")).unwrap(); f.write_all(b" more").unwrap(); }
        let evs = pr.collect(4, |_| false);
        let (dirs, paths) = changed(&evs);
        assert!(dirs.contains("가") && dirs.contains("나"), "{dirs:?}");
        for p in ["가/새.txt", "가/a.txt", "가/b.txt", "나/b.txt", "가/c.txt", "나/복사본.txt", "가/d.txt"] {
            assert!(paths.contains(p), "{p} 없음 {paths:?}");
        }
        /* 실측: 같은 문서 폴더 안에서 다른 폴더로 옮긴 것도 Windows 는 '지움(가/b.txt) + 만듦(나/b.txt)' 으로 알린다 —
           같은 파일인지 확실하지 않으므로 이름 바뀜으로 치지 않는다(업무 링크는 그대로). 밖으로 옮김·지움·복사도 마찬가지 */
        let evs2 = pr.collect(3, |_| false);
        let mut rn = renames(&evs); rn.extend(renames(&evs2));
        assert!(rn.is_empty(), "{rn:?}");
        // 문서 폴더 지우기 — 없어졌다고 한 번 알리고 감시를 끝낸다(핸들을 놓아 지우기가 끝난다)
        let _ = std::fs::remove_dir_all(&d);
        let evs = pr.collect(6, |e| matches!(e, Ev::RootGone { .. }));
        assert!(evs.iter().any(|e| matches!(e, Ev::RootGone { .. })), "{evs:?}");
        drop(pr);
        std::thread::sleep(Duration::from_millis(300));
        let _ = std::fs::remove_dir_all(&d);
        assert!(!d.exists(), "감시를 끝내면 폴더가 실제로 지워진다");
        let _ = std::fs::remove_dir_all(&top);
    }

    /// 압축 풀기·대량 복사처럼 한꺼번에 몰려도 알림은 묶음 몇 개뿐이다(화면이 묶음마다 한 번만 다시 그린다)
    #[cfg(windows)]
    #[test]
    fn bursts_are_batched() {
        let top = std::env::temp_dir().join(format!("wmhh_watch3_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        std::fs::create_dir_all(top.join("풀림")).unwrap();
        let pr = Probe::start(&top);
        let t = Instant::now();
        for k in 0..1500 { std::fs::write(top.join(format!("풀림/f{k:04}.txt")), b"x").unwrap(); }
        let took = t.elapsed();
        let evs = pr.collect(4, |_| false);
        let n = evs.iter().filter(|e| matches!(e, Ev::Changed { .. })).count();
        let max = (took.as_millis() as usize / MAX_WAIT.as_millis() as usize) + 3;
        assert!(n >= 1 && n <= max, "묶음 {n}개(쓰기 {took:?})");
        assert!(evs.iter().all(|e| match e { Ev::Changed { dirs, overflow, .. } => *overflow || dirs.iter().any(|d| d == "풀림"), _ => false }), "{:?}", evs.len());
        drop(pr);
        let _ = std::fs::remove_dir_all(&top);
    }
}
