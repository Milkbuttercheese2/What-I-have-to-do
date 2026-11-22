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
}
pub type Sink = Arc<dyn Fn(Ev) + Send + Sync>;

const ADDED: u32 = 1;
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
        FILE_LIST_DIRECTORY, FILE_NAME_NORMALIZED, FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME, FILE_SHARE_DELETE,
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
        let mut ov = OVERLAPPED::default();
        let mut armed = false;
        while !stop.load(Ordering::SeqCst) {
            if !armed {
                ov = OVERLAPPED { hEvent: h.ev, ..Default::default() };
                unsafe {
                    ReadDirectoryChangesW(h.dir, buf.as_mut_ptr().cast(), (buf.len() * 4) as u32, true,
                        FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME, None, Some(&mut ov), None)
                }.map_err(|e| e.to_string())?;
                armed = true;
            }
            if unsafe { WaitForSingleObject(h.ev, 300) } == WAIT_OBJECT_0 {
                armed = false;
                let mut n = 0u32;
                if unsafe { GetOverlappedResult(h.dir, &ov, &mut n, false) }.is_ok() {
                    let bytes = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), n as usize) };
                    let now = Instant::now();
                    for (a, name) in parse_notify(bytes) { tr.feed(a, name, now); }
                }
                // n == 0 은 넘침(바뀜이 너무 많음) — 그 사이 것은 모른다. 따라가지 않는다
            }
            /* 문서 폴더 자체(또는 위 폴더)의 이름이 바뀌었나 */
            if let Some(now_path) = final_path(h.dir) {
                if now_path != cur {
                    let old = cur.clone();
                    cur = now_path.clone();
                    if !in_recycle_bin(&now_path) && !Path::new(&old).exists() && Path::new(&now_path).is_dir() {
                        sink(Ev::RootMoved { root: i, base: display(&old), to: display(&now_path) });
                    }
                }
            }
            let base = PathBuf::from(&cur);
            for (from, to) in tr.due(Instant::now(), |rel| exists_under(&base, rel)) {
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

    /// 실제 Windows 폴더에서 — 탐색기와 같은 이름 바꾸기(MoveFile)를 감시가 알아채는가, 문서 폴더 자체 이름 바꾸기도
    #[cfg(windows)]
    #[test]
    fn watches_real_folder() {
        use std::sync::mpsc;
        let top = std::env::temp_dir().join(format!("wmhh_watch_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        let d = top.join("문서");
        std::fs::create_dir_all(d.join("옛 폴더")).unwrap();
        std::fs::write(d.join("옛 폴더/보고서.txt"), b"x").unwrap();
        std::fs::write(d.join("지울것.txt"), b"x").unwrap();
        let canon = std::fs::canonicalize(&d).unwrap();
        let (tx, rx) = mpsc::channel::<Ev>();
        let tx = Mutex::new(tx);
        let stop = Arc::new(AtomicBool::new(false));
        let st = stop.clone();
        let root = canon.clone();
        let th = std::thread::spawn(move || {
            let sink: Sink = Arc::new(move |e| { let _ = tx.lock().unwrap().send(e); });
            imp::watch(0, &root, &st, &sink).unwrap();
        });
        std::thread::sleep(Duration::from_millis(400));
        std::fs::rename(d.join("옛 폴더"), d.join("새 폴더")).unwrap();
        std::fs::remove_file(d.join("지울것.txt")).unwrap();
        std::fs::write(d.join("만든것.txt"), b"x").unwrap();
        let e = rx.recv_timeout(Duration::from_secs(6)).expect("이름 바뀜 알림");
        match e {
            Ev::Renamed { root, from, to, .. } => { assert_eq!((root, from.as_str(), to.as_str()), (0, "옛 폴더", "새 폴더")); }
            other => panic!("뜻밖의 알림 {other:?}"),
        }
        // 문서 폴더 자체 — 감시 중에도 이름을 바꿀 수 있어야 한다(FILE_SHARE_DELETE)
        std::fs::rename(&d, top.join("바뀐 문서")).expect("감시 중인 폴더 이름 바꾸기");
        let e = rx.recv_timeout(Duration::from_secs(6)).expect("문서 폴더 이름 바뀜 알림");
        match e {
            Ev::RootMoved { root, base, to } => {
                assert_eq!(root, 0);
                assert!(base.ends_with("문서"), "{base}");
                assert!(to.ends_with("바뀐 문서"), "{to}");
            }
            other => panic!("뜻밖의 알림 {other:?}"),
        }
        assert!(rx.recv_timeout(Duration::from_millis(2500)).is_err(), "지우기·만들기는 알리지 않는다");
        stop.store(true, Ordering::SeqCst);
        th.join().unwrap();
        let _ = std::fs::remove_dir_all(&top);
    }
}
