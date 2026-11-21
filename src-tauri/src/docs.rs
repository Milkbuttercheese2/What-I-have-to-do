//! v3.8.0 문서 탭 — 사용자가 고른 **문서 폴더들**(v3.8.1: 여러 개) 안만 다룬다.
//!
//! - 화면은 (폴더 번호, 그 폴더 기준 **상대 경로**)만 넘긴다. 여기서 루트와 합쳐 정규화(canonicalize)한 뒤
//!   루트 밖이면(`..`·절대 경로·바로가기 등) 거부한다 — `resolve` 하나가 모든 명령의 관문이다.
//! - 파일 내용을 쓰는 길은 `doc_write_text` 하나(v3.8.1, 사용자 지정): **글자 파일만**(txt·md·csv·코드 등 — 내용으로 판정),
//!   읽을 때의 인코딩 그대로(UTF-8·UTF-8 BOM·UTF-16LE·EUC-KR(CP949)), 읽은 뒤 다른 프로그램이 고쳤으면 거부(덮어쓰기 방지).
//!   HWPX·XLSX·PPTX 같은 문서는 쓰지 않는다(편집은 그 프로그램에서). 내용은 진단 로그에 남기지 않는다.
//! - 유일한 쓰기는 `doc_move`(트리에서 끌어 옮기기, 사용자 지정): 같은 문서 폴더 안에서 **이름 그대로 옮기기만** 한다.
//!   같은 이름이 있으면 거부(덮어쓰지 않음), 폴더를 자기 안으로 옮기기 거부, 다른 드라이브로는 옮기지 않는다(복사 없음).
//! - 목록은 한 단계씩만 읽는다(펼칠 때마다) — 공유 드라이브를 처음에 통째로 훑지 않는다.
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// 지금 문서 폴더들(정규화된 절대 경로, 화면의 settings.docRoots 순서). `doc_set_roots` 로 잡는다.
static ROOTS: Mutex<Vec<Option<PathBuf>>> = Mutex::new(Vec::new());

/// 글자 파일 편집 상한(바이트)
pub const TEXT_MAX: u64 = 5 * 1024 * 1024;

/// 미리보기로 읽는 파일 크기 상한(바이트). 넘으면 화면은 정보와 [열기]만 보여 준다.
pub const READ_MAX: u64 = 30 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct DocEntry {
    pub name: String,
    /// 루트 기준 상대 경로('/' 구분)
    pub rel: String,
    pub dir: bool,
    pub size: u64,
    /// 고친 시각(epoch ms) — 모르면 0
    pub mtime: i64,
}

fn root(i: usize) -> Result<PathBuf, String> {
    ROOTS.lock().unwrap_or_else(|e| e.into_inner()).get(i).cloned().flatten().ok_or_else(|| "문서 폴더가 지정되지 않았거나 열 수 없습니다".to_string())
}

fn canon_dir(path: &str) -> Result<PathBuf, String> {
    let p = std::fs::canonicalize(path).map_err(|e| format!("폴더를 열 수 없습니다: {e}"))?;
    if !p.is_dir() {
        return Err("폴더가 아닙니다".into());
    }
    Ok(p)
}

#[derive(Debug, Serialize)]
pub struct RootInfo {
    pub ok: bool,
    pub path: String,
    pub error: String,
}

/// `\\?\` 접두를 뗀 보기용 경로. 공유 폴더는 `canonicalize` 가 `\\?\UNC\서버\공유\…` 로 돌려주므로
/// `\\서버\공유\…` 로 되돌린다 — `\\?\` 만 떼면 `UNC\서버\…` 라는 상대 경로가 되어 열기·휴지통이 실패했다.
fn display(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
}

/// 휴지통으로 보내도 **되살릴 수 있는 자리인가**. Windows 는 휴지통이 없는 곳(공유 폴더·USB 같은 이동식
/// 드라이브·네트워크 드라이브)에서 '휴지통으로'를 받으면 경고 없이 **영구 삭제**한다(`FOF_NOCONFIRMATION`).
/// 화면은 "휴지통에서 되살릴 수 있습니다"라고 안내하므로, 그런 자리에서는 지우지 않고 거부한다.
/// `drive_type` 은 `GetDriveTypeW` 값(3 = 고정 디스크) — 시험에서 바꿔 끼울 수 있게 밖에서 받는다.
fn trash_place_ok(shown: &str, drive_type: impl FnOnce(&str) -> u32) -> Result<(), String> {
    const NO_BIN: &str = "이 위치(공유 폴더·네트워크·이동식 드라이브)에는 휴지통이 없어, 지우면 되살릴 수 없습니다.\n지우려면 탐색기에서 직접 지워 주세요.";
    if shown.starts_with(r"\\") {
        return Err(NO_BIN.into());
    }
    let b = shown.as_bytes();
    if b.len() < 2 || b[1] != b':' {
        return Err(NO_BIN.into());
    }
    const DRIVE_FIXED: u32 = 3;
    if drive_type(&format!("{}\\", &shown[..2])) != DRIVE_FIXED {
        return Err(NO_BIN.into());
    }
    Ok(())
}

/// 상대 경로 → 루트 안의 실제 경로. 루트 밖이면 Err.
/// 1차: 상대 경로 자체에 `..`·루트·드라이브 접두가 있으면 거부.
/// 2차: 합친 경로를 정규화(바로가기·정션을 따라감)해 루트로 시작하는지 확인.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    let rp = Path::new(rel.trim_start_matches("./"));
    for c in rp.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("문서 폴더 밖의 경로입니다".into()),
        }
    }
    let joined = root.join(rp);
    let canon = std::fs::canonicalize(&joined).map_err(|e| format!("찾을 수 없습니다: {e}"))?;
    let root_c = std::fs::canonicalize(root).map_err(|e| format!("문서 폴더를 열 수 없습니다: {e}"))?;
    if !canon.starts_with(&root_c) {
        return Err("문서 폴더 밖의 경로입니다".into());
    }
    Ok(canon)
}

/// 옮기기·이름 바꾸기·복제·휴지통처럼 **항목 하나를 바꾸는** 명령의 대상. `resolve` 에 두 가지를 더 본다.
/// 1. 결과가 문서 폴더 자체면 거부 — `""` 만 막던 문자열 검사는 `"."`·`"./"` 를 그대로 통과시켰다.
/// 2. 대상이 링크·정션이면 거부 — `resolve` 는 링크를 따라가므로 그대로 두면 링크가 아니라
///    **링크가 가리키는 진짜 폴더**를 지우거나 이름을 바꾼다(루트를 가리키는 정션이면 문서 폴더 전체).
pub fn resolve_item(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon = resolve(root, rel)?;
    let root_c = std::fs::canonicalize(root).map_err(|e| format!("문서 폴더를 열 수 없습니다: {e}"))?;
    if canon == root_c {
        return Err("문서 폴더 자체는 여기서 바꿀 수 없습니다".into());
    }
    let rel = rel.replace('\\', "/");
    let joined = root.join(Path::new(rel.trim_start_matches("./")));
    if std::fs::symlink_metadata(&joined).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err("바로 연결(링크·정션)은 여기서 바꿀 수 없습니다 — 탐색기에서 해 주세요".into());
    }
    Ok(canon)
}

fn rel_of(root: &Path, p: &Path) -> String {
    let root_c = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    p.strip_prefix(&root_c).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn mtime_ms(md: &std::fs::Metadata) -> i64 {
    md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// 숨김·시스템 파일, `.` 으로 시작하는 것, 오피스 임시 파일(`~$`)은 보이지 않는다.
fn hidden(name: &str, md: &std::fs::Metadata) -> bool {
    if name.starts_with('.') || name.starts_with("~$") {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if md.file_attributes() & (HIDDEN | SYSTEM) != 0 {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = md;
    false
}

pub fn list_in(root: &Path, rel: &str) -> Result<Vec<DocEntry>, String> {
    let dir = resolve(root, rel)?;
    if !dir.is_dir() {
        return Err("폴더가 아닙니다".into());
    }
    let mut out = Vec::new();
    for ent in std::fs::read_dir(&dir).map_err(|e| format!("폴더를 읽을 수 없습니다: {e}"))?.flatten() {
        let name = ent.file_name().to_string_lossy().into_owned();
        let Ok(md) = ent.metadata() else { continue };
        if hidden(&name, &md) {
            continue;
        }
        let path = ent.path();
        out.push(DocEntry { rel: rel_of(root, &path), name, dir: md.is_dir(), size: if md.is_dir() { 0 } else { md.len() }, mtime: mtime_ms(&md) });
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub fn read_in(root: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let p = resolve(root, rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("읽을 수 없습니다: {e}"))?;
    if md.is_dir() {
        return Err("폴더입니다".into());
    }
    if md.len() > READ_MAX {
        return Err("미리보기 상한(30MB) 초과".into());
    }
    std::fs::read(&p).map_err(|e| format!("읽을 수 없습니다(다른 프로그램에서 사용 중일 수 있음): {e}"))
}

/// 항목(파일·폴더) 하나를 같은 문서 폴더 안의 다른 폴더로 옮긴다. 새 상대 경로를 돌려준다.
pub fn move_in(root: &Path, from: &str, to_dir: &str) -> Result<String, String> {
    if from.trim_matches('/').is_empty() {
        return Err("문서 폴더 자체는 옮길 수 없습니다".into());
    }
    let src = resolve_item(root, from)?;
    let dir = resolve(root, to_dir)?;
    if !dir.is_dir() {
        return Err("폴더로만 옮길 수 있습니다".into());
    }
    if dir.starts_with(&src) {
        return Err("폴더를 자기 안으로 옮길 수 없습니다".into());
    }
    let name = src.file_name().ok_or_else(|| "이름을 알 수 없습니다".to_string())?;
    let dest = dir.join(name);
    if src.parent() == Some(dir.as_path()) {
        return Err("이미 그 폴더에 있습니다".into());
    }
    if dest.exists() {
        return Err("같은 이름이 이미 있습니다".into());
    }
    std::fs::rename(&src, &dest).map_err(|e| format!("옮기지 못했습니다(다른 프로그램에서 사용 중이거나 다른 드라이브일 수 있음): {e}"))?;
    Ok(rel_of(root, &dest))
}

/* ── 새로 만들기·이름 바꾸기 (v3.8.1 — 트리 오른쪽 클릭) ─────────────────── */

/// 파일·폴더 이름 하나로 쓸 수 있는지(Windows 규칙). 경로 구분자·예약 글자·끝 점/공백·예약 이름 거부.
pub fn check_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." {
        return Err("이름을 입력해 주세요".into());
    }
    if n.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 32) {
        return Err("이름에 쓸 수 없는 글자가 있습니다 ( \\ / : * ? \" < > | )".into());
    }
    if n.ends_with('.') {
        return Err("이름 끝에 점을 쓸 수 없습니다".into());
    }
    let stem = n.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        return Err("Windows 가 쓰는 이름이라 쓸 수 없습니다".into());
    }
    if n.chars().count() > 200 {
        return Err("이름이 너무 깁니다".into());
    }
    Ok(n.to_string())
}

/// 폴더 dir 안에 새 파일(빈 파일)이나 새 폴더. 같은 이름이 있으면 거부(덮어쓰지 않는다). 새 항목의 rel.
pub fn create_in(root: &Path, dir: &str, name: &str, is_dir: bool) -> Result<String, String> {
    let name = check_name(name)?;
    let d = resolve(root, dir)?;
    if !d.is_dir() {
        return Err("폴더 안에만 만들 수 있습니다".into());
    }
    let dest = d.join(&name);
    if dest.exists() {
        return Err("같은 이름이 이미 있습니다".into());
    }
    if is_dir {
        std::fs::create_dir(&dest).map_err(|e| format!("폴더를 만들지 못했습니다: {e}"))?;
    } else {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| format!("파일을 만들지 못했습니다: {e}"))?;
    }
    Ok(rel_of(root, &dest))
}

/// 이름 바꾸기 — 같은 폴더 안에서만. 대소문자만 바꾸는 것은 허용. 새 rel.
pub fn rename_in(root: &Path, rel: &str, new_name: &str) -> Result<String, String> {
    if rel.trim_matches('/').is_empty() {
        return Err("문서 폴더 자체의 이름은 여기서 바꿀 수 없습니다".into());
    }
    let name = check_name(new_name)?;
    let src = resolve_item(root, rel)?;
    let parent = src.parent().ok_or_else(|| "이름을 바꿀 수 없습니다".to_string())?;
    let dest = parent.join(&name);
    let same_ci = src.file_name().map(|f| f.to_string_lossy().to_lowercase()) == Some(name.to_lowercase());
    if dest.exists() && !same_ci {
        return Err("같은 이름이 이미 있습니다".into());
    }
    std::fs::rename(&src, &dest).map_err(|e| format!("이름을 바꾸지 못했습니다(다른 프로그램에서 사용 중일 수 있음): {e}"))?;
    Ok(rel_of(root, &dest))
}

/* ── 새 한글·엑셀·파워포인트 문서 (v3.8.1 — 오른쪽 클릭) ─────────────────
   먼저 Windows '새로 만들기'에 등록된 서식(설치된 한컴오피스·MS Office 가 만드는 그 파일)을 쓰고,
   없으면 앱에 든 빈 문서(templates/blank.*)를 쓴다. 0바이트 파일은 한글·엑셀이 '손상된 파일'로 거부하므로 만들지 않는다. */
const BLANK_HWPX: &[u8] = include_bytes!("../templates/blank.hwpx");
const BLANK_XLSX: &[u8] = include_bytes!("../templates/blank.xlsx");
const BLANK_PPTX: &[u8] = include_bytes!("../templates/blank.pptx");

pub fn builtin_blank(ext: &str) -> Option<&'static [u8]> {
    match ext {
        "hwpx" => Some(BLANK_HWPX),
        "xlsx" => Some(BLANK_XLSX),
        "pptx" => Some(BLANK_PPTX),
        _ => None,
    }
}

#[cfg(windows)]
mod shellnew {
    use std::path::PathBuf;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CLASSES_ROOT, REG_BINARY, REG_VALUE_TYPE, RRF_RT_ANY};

    /// (종류, 바이트) — 값이 없으면 None
    fn value(sub: &str, name: &str) -> Option<(REG_VALUE_TYPE, Vec<u8>)> {
        let (k, n) = (HSTRING::from(sub), HSTRING::from(name));
        let mut ty = REG_VALUE_TYPE(0);
        let mut size = 0u32;
        unsafe {
            if RegGetValueW(HKEY_CLASSES_ROOT, PCWSTR(k.as_ptr()), PCWSTR(n.as_ptr()), RRF_RT_ANY, Some(&mut ty), None, Some(&mut size)) != ERROR_SUCCESS || size > 64 * 1024 * 1024 {
                return None;
            }
            let mut buf = vec![0u8; size as usize];
            if RegGetValueW(HKEY_CLASSES_ROOT, PCWSTR(k.as_ptr()), PCWSTR(n.as_ptr()), RRF_RT_ANY, Some(&mut ty), Some(buf.as_mut_ptr() as _), Some(&mut size)) != ERROR_SUCCESS {
                return None;
            }
            buf.truncate(size as usize);
            Some((ty, buf))
        }
    }
    fn text(b: &[u8]) -> String {
        let u: Vec<u16> = b.chunks(2).map(|c| u16::from_le_bytes([c[0], *c.get(1).unwrap_or(&0)])).collect();
        String::from_utf16_lossy(&u).trim_end_matches('\0').to_string()
    }
    fn expand(s: &str) -> String {
        let h = HSTRING::from(s);
        let mut buf = vec![0u16; 4096];
        let n = unsafe { ExpandEnvironmentStringsW(PCWSTR(h.as_ptr()), Some(&mut buf)) } as usize;
        if n == 0 || n > buf.len() { return s.to_string(); }
        String::from_utf16_lossy(&buf[..n.saturating_sub(1)])
    }
    fn template_file(name: &str) -> Option<PathBuf> {
        let p = PathBuf::from(expand(name));
        if p.is_absolute() {
            return p.is_file().then_some(p);
        }
        let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
        [
            env("SystemRoot").map(|r| r.join("ShellNew")),
            env("APPDATA").map(|r| r.join("Microsoft\\Windows\\Templates")),
            env("ProgramData").map(|r| r.join("Microsoft\\Windows\\Templates")),
        ]
        .into_iter()
        .flatten()
        .map(|d| d.join(&p))
        .find(|c| c.is_file())
    }
    /// 확장자(점 없이)에 등록된 '새로 만들기' 서식의 내용. FileName(서식 파일) 또는 Data(바이트)만 쓴다.
    pub fn template(ext: &str) -> Option<Vec<u8>> {
        let key = format!(".{ext}");
        let progid = value(&key, "").map(|(_, b)| text(&b)).unwrap_or_default();
        let mut keys = vec![format!("{key}\\ShellNew")];
        if !progid.is_empty() {
            keys.push(format!("{key}\\{progid}\\ShellNew"));
        }
        for k in keys {
            if let Some((_, b)) = value(&k, "FileName") {
                if let Some(f) = template_file(&text(&b)) {
                    if let Ok(bytes) = std::fs::read(f) {
                        if !bytes.is_empty() {
                            return Some(bytes);
                        }
                    }
                }
            }
            if let Some((ty, b)) = value(&k, "Data") {
                if ty == REG_BINARY && !b.is_empty() {
                    return Some(b);
                }
            }
        }
        None
    }
}

/// 새 문서 내용 — 등록된 서식 → 앱에 든 빈 문서 순서
pub fn new_doc_bytes(ext: &str) -> Option<Vec<u8>> {
    let ext = ext.to_ascii_lowercase();
    #[cfg(windows)]
    if let Some(b) = shellnew::template(&ext) {
        return Some(b);
    }
    builtin_blank(&ext).map(|b| b.to_vec())
}

/// dir 안에 새 문서(한글·엑셀·파워포인트). 같은 이름이면 거부. 새 rel.
pub fn create_doc_in(root: &Path, dir: &str, name: &str) -> Result<String, String> {
    use std::io::Write;
    let name = check_name(name)?;
    let ext = Path::new(&name).extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    let bytes = new_doc_bytes(&ext).ok_or_else(|| format!("'.{ext}' 새 문서는 만들 수 없습니다"))?;
    let d = resolve(root, dir)?;
    if !d.is_dir() {
        return Err("폴더 안에만 만들 수 있습니다".into());
    }
    let dest = d.join(&name);
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists { "같은 이름이 이미 있습니다".to_string() } else { format!("파일을 만들지 못했습니다: {e}") }
    })?;
    f.write_all(&bytes).map_err(|e| format!("파일을 만들지 못했습니다: {e}"))?;
    Ok(rel_of(root, &dest))
}

/* ── 바깥(탐색기)에서 끌어 온 파일·폴더를 문서 폴더 안으로 복사 (v3.8.1) ──────
   옮기지 않고 **복사**한다 — 원본은 그대로(실수로 놓아도 잃는 것이 없다). 같은 이름이 있으면 ' (2)' … 를 붙인다. */
fn free_dest(dir: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 2..10000 {
        let c = dir.join(format!("{stem} ({n}){ext}"));
        if !c.exists() {
            return c;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}
fn copy_tree(src: &Path, dest: &Path, budget: &mut u32) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        return Ok(()); // 바로 가기(링크)는 따라가지 않는다
    }
    if *budget == 0 {
        return Err(std::io::Error::new(std::io::ErrorKind::Other, "파일이 너무 많습니다(2만 개 초과)"));
    }
    *budget -= 1;
    if meta.is_dir() {
        std::fs::create_dir(dest)?;
        for e in std::fs::read_dir(src)? {
            let e = e?;
            copy_tree(&e.path(), &dest.join(e.file_name()), budget)?;
        }
        Ok(())
    } else {
        std::fs::copy(src, dest).map(|_| ())
    }
}
/// 바깥 경로들을 dir 안으로 복사(mv=true 면 옮기기). 새로 생긴 항목들의 rel. 하나라도 실패하면 그 이유를 모아 Err(이미 한 것은 남긴다).
/// 옮기기: 같은 드라이브면 이름만 바꾸고(rename), 다른 드라이브면 **복사가 끝난 뒤에만** 원본을 지운다.
pub fn import_in(root: &Path, dir: &str, paths: &[String], mv: bool) -> Result<Vec<String>, String> {
    let d = resolve(root, dir)?;
    if !d.is_dir() {
        return Err("폴더 안에만 넣을 수 있습니다".into());
    }
    let mut out = Vec::new();
    let mut errs = Vec::new();
    let mut budget: u32 = 20_000;
    for p in paths {
        let src = match std::fs::canonicalize(p) {
            Ok(s) => s,
            Err(e) => { errs.push(format!("{p}: {e}")); continue; }
        };
        let Some(name) = src.file_name().map(|n| n.to_os_string()) else { errs.push(format!("{p}: 드라이브 전체는 넣을 수 없습니다")); continue; };
        if d.starts_with(&src) {
            errs.push(format!("{}: 폴더를 자기 안으로 넣을 수 없습니다", name.to_string_lossy()));
            continue;
        }
        if src.parent() == Some(d.as_path()) {
            continue; // 이미 그 폴더에 있다 — 복사본을 만들지 않는다
        }
        let dest = free_dest(&d, &name);
        if mv && std::fs::rename(&src, &dest).is_ok() {
            out.push(rel_of(root, &dest));
            continue;
        }
        match copy_tree(&src, &dest, &mut budget) {
            Ok(()) => {
                if mv {
                    let gone = if src.is_dir() { std::fs::remove_dir_all(&src) } else { std::fs::remove_file(&src) };
                    if let Err(e) = gone {
                        errs.push(format!("{}: 복사는 했지만 원본을 지우지 못했습니다({e})", name.to_string_lossy()));
                    }
                }
                out.push(rel_of(root, &dest))
            }
            Err(e) => errs.push(format!("{}: {e}", name.to_string_lossy())),
        }
    }
    if errs.is_empty() { Ok(out) } else { Err(format!("{}개를 넣지 못했습니다\n{}", errs.len(), errs.join("\n"))) }
}

/* ── HTML 보기용 전용 주소 `wmhhdoc` (v3.8.4) ─────────────────────────────
   `http://wmhhdoc.localhost/<폴더번호>/<상대경로>` → 그 파일의 바이트. 앱 화면(tauri.localhost)과 **다른 출처**라
   앱의 보안 정책(스크립트 금지)을 물려받지 않는다 — 그래서 HTML 문서가 자기 스크립트·CSS·그림(상대 경로)까지 그대로 돈다.
   안전장치: ① 경로는 여기서도 resolve 로 문서 폴더 안인지 확인 ② 화면은 모래상자 프레임(allow-scripts 만)에 넣어
   앱 화면·앱 기능(IPC)에 닿지 못한다 ③ 응답에 보안 정책을 실어 바깥(인터넷)으로 나가지 못하게 한다. 읽기 전용. */
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = ((b[i + 1] as char).to_digit(16), (b[i + 2] as char).to_digit(16)) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("html") | Some("htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") | Some("jfif") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("txt") | Some("csv") | Some("md") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}
/// 주소의 경로 부분("/0/가 폴더/a.html", 퍼센트 부호화) → (바이트, MIME). 폴더 밖·없는 파일·너무 큰 파일은 Err.
pub fn serve_path(uri_path: &str) -> Result<(Vec<u8>, &'static str), String> {
    let p = uri_path.trim_start_matches('/');
    let (idx, rest) = p.split_once('/').ok_or_else(|| "주소가 잘못됐습니다".to_string())?;
    let i: usize = idx.parse().map_err(|_| "주소가 잘못됐습니다".to_string())?;
    let rel = percent_decode(rest);
    let full = resolve(&self::root(i)?, &rel)?;
    let md = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    if md.is_dir() {
        return Err("폴더입니다".into());
    }
    if md.len() > 100 * 1024 * 1024 {
        return Err("너무 큽니다".into());
    }
    let bytes = std::fs::read(&full).map_err(|e| e.to_string())?;
    Ok((bytes, mime_of(&full)))
}

/* ── 휴지통 (v3.8.3) ─────────────────────────────────────────────────── */
pub fn trash_in(root: &Path, rel: &str) -> Result<(), String> {
    if rel.trim_matches('/').is_empty() {
        return Err("문서 폴더 자체는 지울 수 없습니다".into());
    }
    let p = resolve_item(root, rel)?;
    if !p.exists() {
        return Err("이미 없습니다".into());
    }
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::GetDriveTypeW;
        use windows::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
        let shown = display(&p);
        trash_place_ok(&shown, |vol| {
            let w: Vec<u16> = vol.encode_utf16().chain([0]).collect();
            unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) }
        })?;
        let mut from: Vec<u16> = shown.encode_utf16().collect();
        from.extend([0, 0]); // 이중 NUL 끝
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            /* FOF_WANTNUKEWARNING: 고정 디스크라도 휴지통이 꺼져 있거나 휴지통보다 큰 항목이면 Windows 가
               영구 삭제 전에 한 번 묻는다(FOF_NOCONFIRMATION 을 그 경우에만 덮는다). 아니오 → 중단 → 아래 오류. */
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT | FOF_WANTNUKEWARNING).0 as u16,
            ..Default::default()
        };
        let r = unsafe { SHFileOperationW(&mut op) };
        if r != 0 || op.fAnyOperationsAborted.as_bool() {
            return Err(format!("휴지통으로 보내지 못했습니다(다른 프로그램에서 사용 중일 수 있음, 코드 {r})"));
        }
        if p.exists() {
            return Err("휴지통으로 보내지 못했습니다".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("이 환경에선 휴지통을 쓸 수 없습니다".into())
    }
}

/* ── 문서 찾기 (v3.8.3) ───────────────────────────────────────────────── */
#[derive(Debug, Serialize, PartialEq)]
pub struct SearchHit {
    pub rel: String,
    pub name: String,
    pub dir: bool,
    /// "name" | "text"
    pub hit: String,
    /// 내용으로 걸렸을 때 그 줄(앞뒤 조금)
    pub snippet: String,
}
const SEARCH_MAX_HITS: usize = 200;
const SEARCH_MAX_ENTRIES: usize = 60_000; // 이만큼 훑으면 멈춘다(공유 폴더가 클 때)
const SEARCH_TEXT_MAX: u64 = 1024 * 1024; // 내용은 1MB 이하 글자 파일만
const SEARCH_TEXT_BUDGET: u64 = 64 * 1024 * 1024; // 한 번 찾기에 읽는 총량
const SEARCH_TEXT_EXT: &[&str] = &["txt", "md", "markdown", "csv", "tsv", "json", "xml", "log", "ini", "cfg", "conf", "yaml", "yml", "toml", "html", "htm", "sql"];

fn snippet_of(line: &str, at: usize, qlen: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    let pre: usize = line[..at].chars().count();
    let s = pre.saturating_sub(20);
    let e = (pre + qlen + 40).min(chars.len());
    let mut out: String = chars[s..e].iter().collect();
    if s > 0 { out.insert(0, '…'); }
    if e < chars.len() { out.push('…'); }
    out.trim().to_string()
}

/// 찾기 색인(v3.8.4) — 폴더를 한 번 훑어 이름과 작은 글자 파일의 내용을 메모리에 둔다.
/// 예전엔 글자를 칠 때마다 디스크를 처음부터 다시 훑고 파일을 다시 읽어(최대 64MB) 느렸다.
/// 색인이 SEARCH_CACHE_SECS 보다 오래되면 뒤에서 새로 만들고(그동안은 있던 색인으로 답한다), 앱이 문서를 바꾸면(만들기·이름·옮기기·휴지통) 그 폴더 색인만 버리고, 글자 저장은 그 파일 내용만 바꿔 끼운다.
/// 내용은 `Arc<str>` — 글자 파일 하나를 저장할 때 색인을 복사해 그 줄만 바꿔 끼우는데(patch_search_text),
/// 그때 다른 파일들의 내용(최대 64MB)까지 복사하지 않게.
#[derive(Clone)]
struct IdxEntry { rel: String, name: String, low: String, dir: bool, text: Option<std::sync::Arc<str>> }
struct SearchIndex { base: PathBuf, built: std::time::Instant, ents: Vec<IdxEntry> }
static SEARCH_CACHE: Mutex<Vec<std::sync::Arc<SearchIndex>>> = Mutex::new(Vec::new());
const SEARCH_CACHE_SECS: u64 = 30;
/// 색인 세대 — 문서가 바뀔 때마다 하나 올린다. 만들기 시작할 때의 세대와 넣을 때의 세대가 다르면 그 색인은
/// 바뀌기 전 디스크를 훑은 것이라 넣지 않는다(예전엔 만드는 도중 저장·휴지통이 있어도 낡은 색인을 다시 넣었다).
/// 세대는 **폴더별**이다 — 한 폴더의 변화가 다른 폴더 색인 넣기를 막지 않게.
/// 잠금 순서는 항상 SEARCH_CACHE → SEARCH_GENS(넣기·버리기), 만들기 시작은 SEARCH_GENS 만.
static SEARCH_GENS: Mutex<Vec<(PathBuf, u64)>> = Mutex::new(Vec::new());
fn search_gen(base: &Path) -> u64 {
    let mut g = SEARCH_GENS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, v)) = g.iter().find(|(k, _)| k == base) { return *v }
    g.push((base.to_path_buf(), 0));   // 만들기 시작할 때 자리를 잡아 둬야, 그 사이 변화가 이 폴더 세대를 올린다
    0
}
/// changed 와 겹치는(같거나 안팎인) 폴더들의 세대를 올린다
fn bump_search_gens(changed: Option<&Path>) {
    let mut g = SEARCH_GENS.lock().unwrap_or_else(|e| e.into_inner());
    for (k, v) in g.iter_mut() {
        if changed.map_or(true, |b| b.starts_with(&*k) || k.starts_with(b)) { *v += 1; }
    }
}

/// 문서를 바꾼 **뒤에** 부른다 — 그 문서 폴더(와 겹치는 폴더)의 색인만 버린다. 예전엔 모든 폴더의 색인을 버려서,
/// 한 폴더에서 일하는 동안 다른 공유 폴더 찾기도 매번 처음부터 다시 훑었다.
/// 작업 '전'에 버리면 작업 도중 시작된 찾기가 바뀌기 전 상태로 색인을 다시 채울 수 있다 — 그래서 뒤에, 세대와 함께.
pub fn invalidate_search_root(root: &Path) {
    let base = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut c = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    bump_search_gens(Some(&base));
    c.retain(|x| !(base.starts_with(&x.base) || x.base.starts_with(&base)));
}

/// 글자 파일 하나를 저장한 뒤 — 색인을 버리지 않고 그 파일의 내용만 바꿔 끼운다. 글자 파일은 고치는 동안 1.2초마다
/// 저장되는데, 그때마다 색인을 버리면 고치는 내내 찾기가 폴더를 처음부터 다시 훑었다(공유 폴더는 한 번에 10초 넘게).
/// 색인에 없는 파일이면(새로 생긴 등) 그 폴더 색인을 버린다.
pub fn patch_search_text(root: &Path, rel: &str, text: &str) {
    let base = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    // 성분 단위로 붙인다 — `\\?\` 경로에는 '/' 가 구분자로 읽히지 않는다
    let full = rel.replace('\\', "/").split('/').filter(|s| !s.is_empty() && *s != ".").fold(base.clone(), |p, s| p.join(s));
    let ext = full.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let keep_text = text.len() as u64 <= SEARCH_TEXT_MAX && SEARCH_TEXT_EXT.contains(&ext.as_str());
    let mut c = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    bump_search_gens(Some(&base));   // 만드는 중이던 색인은 이 저장 전 내용이라 넣지 않는다
    let mut drop_bases = Vec::new();
    for slot in c.iter_mut() {
        let Ok(inner) = full.strip_prefix(&slot.base) else { continue };
        let r = inner.to_string_lossy().replace('\\', "/");
        match slot.ents.iter().position(|e| e.rel == r && !e.dir) {
            Some(pos) => {
                let mut ents = slot.ents.clone();
                ents[pos].text = if keep_text { Some(std::sync::Arc::from(text)) } else { None };
                *slot = std::sync::Arc::new(SearchIndex { base: slot.base.clone(), built: slot.built, ents });
            }
            None => drop_bases.push(slot.base.clone()),
        }
    }
    c.retain(|x| !drop_bases.contains(&x.base));
}

fn build_index(base: &Path) -> SearchIndex {
    let rel = |p: &Path| p.strip_prefix(base).unwrap_or(p).to_string_lossy().replace('\\', "/");
    let mut ents = Vec::new();
    let mut budget = SEARCH_TEXT_BUDGET;
    let mut stack = vec![base.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut list: Vec<_> = rd.flatten().collect();
        list.sort_by_key(|e| e.file_name());
        for ent in list {
            if ents.len() >= SEARCH_MAX_ENTRIES { break 'walk }
            let name = ent.file_name().to_string_lossy().into_owned();
            let Ok(ft) = ent.file_type() else { continue };
            if ft.is_symlink() { continue }
            let Ok(md) = ent.metadata() else { continue };
            if hidden(&name, &md) { continue }
            let path = ent.path();
            let is_dir = md.is_dir();
            if is_dir { stack.push(path.clone()); }
            let mut text = None;
            if !is_dir && md.len() <= SEARCH_TEXT_MAX && md.len() <= budget {
                let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if SEARCH_TEXT_EXT.contains(&ext.as_str()) {
                    if let Ok(bytes) = std::fs::read(&path) {
                        budget = budget.saturating_sub(bytes.len() as u64);
                        text = decode_text(&bytes).map(|(t, _)| std::sync::Arc::from(t));
                    }
                }
            }
            ents.push(IdxEntry { rel: rel(&path), low: name.to_lowercase(), name, dir: is_dir, text });
        }
    }
    SearchIndex { base: base.to_path_buf(), built: std::time::Instant::now(), ents }
}

fn query_index(ix: &SearchIndex, query: &str) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() { return vec![] }
    let qlen = q.chars().count();
    let mut out = Vec::new();
    for e in &ix.ents {
        if out.len() >= SEARCH_MAX_HITS { break }
        if e.low.contains(&q) {
            out.push(SearchHit { rel: e.rel.clone(), name: e.name.clone(), dir: e.dir, hit: "name".into(), snippet: String::new() });
            continue;
        }
        let Some(text) = &e.text else { continue };
        for line in text.lines() {
            let low = line.to_lowercase();
            if let Some(at) = low.find(&q) {
                // 소문자 바꾸기로 바이트 위치가 어긋날 수 있어 원문 기준으로 다시 맞춘다
                let at = if line.is_char_boundary(at) && line.len() == low.len() { at } else { 0 };
                out.push(SearchHit { rel: e.rel.clone(), name: e.name.clone(), dir: false, hit: "text".into(), snippet: snippet_of(line, at, qlen) });
                break;
            }
        }
    }
    out
}

/// 색인을 새로 만들어 찾는다(시험·한 번 쓰기용)
pub fn search_in(root: &Path, query: &str) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() { return Ok(vec![]) }
    let base = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    Ok(query_index(&build_index(&base), query))
}

/// 30초 안에 만든 같은 폴더의 색인이 있으면 그대로 쓴다
pub fn search_cached(root: &Path, query: &str) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() { return Ok(vec![]) }
    let base = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let have = {
        let c = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        c.iter().find(|x| x.base == base).cloned()
    };
    let ix = match have {
        /* 오래된 색인이라도 바로 답하고, 새 색인은 뒤에서 만든다 — 공유 폴더는 한 번 훑는 데 10초가 넘을 수 있어
           30초마다 그만큼 기다리게 할 수 없다. 앱이 문서를 바꾼 경우는 invalidate_search_root(글자 저장은 patch_search_text)가 맡는다 */
        Some(ix) => {
            if ix.built.elapsed().as_secs() >= SEARCH_CACHE_SECS { refresh_later(base.clone()); }
            ix
        }
        None => match wait_for_build(&base) {
            /* 문서 탭을 열 때 시작한 미리 만들기가 아직 도는 중이면 끝나길 기다렸다가 그 색인을 쓴다(v3.8.9) —
               같은 폴더를 두 번 훑지 않는다(공유 폴더는 한 번 훑는 데 10초가 넘는다) */
            Some(ix) => ix,
            None => {
                let g = search_gen(&base);
                let ix = std::sync::Arc::new(build_index(&base));
                store_index_if(ix.clone(), g);   // 훑는 사이 문서가 바뀌었으면 이번 답에만 쓰고 넣지 않는다
                ix
            }
        },
    };
    Ok(query_index(&ix, query))
}

/// 같은 폴더 색인을 다른 스레드가 만드는 중이면 끝날 때까지(최대 SEARCH_WAIT_SECS) 기다려 그 색인을 돌려준다.
/// 아무도 안 만들고 있거나, 만들다 실패해 색인이 없으면 None — 부르는 쪽이 직접 만든다.
const SEARCH_WAIT_SECS: u64 = 120;
fn wait_for_build(base: &Path) -> Option<std::sync::Arc<SearchIndex>> {
    let t0 = std::time::Instant::now();
    loop {
        let building = REFRESHING.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|x| x == base);
        let have = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner()).iter().find(|x| x.base == base).cloned();
        if have.is_some() { return have; }
        if !building || t0.elapsed().as_secs() >= SEARCH_WAIT_SECS { return None; }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

/// 만들기 시작할 때의 세대(gen)가 지금도 같을 때만 넣는다 — 위 SEARCH_GEN 설명. 넣었으면 true
fn store_index_if(ix: std::sync::Arc<SearchIndex>, gen: u64) -> bool {
    let mut c = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if search_gen(&ix.base) != gen { return false }
    c.retain(|x| x.base != ix.base);
    c.push(ix);
    true
}

static REFRESHING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
fn refresh_later(base: PathBuf) {
    {
        let mut r = REFRESHING.lock().unwrap_or_else(|e| e.into_inner());
        if r.contains(&base) { return }                    // 이미 만드는 중
        r.push(base.clone());
    }
    std::thread::spawn(move || {
        let g = search_gen(&base);
        let ix = std::sync::Arc::new(build_index(&base));
        /* 만드는 사이 앱이 문서를 바꿨다면(세대가 다르면) 넣지 않는다 — 다음 찾기가 새로 만든다 */
        store_index_if(ix, g);
        REFRESHING.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| x != &base);
    });
}

/* ── 글자 파일 (v3.8.1) — 읽기·쓰기, 인코딩 보존 ─────────────────────────── */

#[derive(Debug, Serialize, PartialEq)]
pub struct TextFile {
    pub text: String,
    /// "utf-8" | "utf-8-bom" | "utf-16le" | "cp949"
    pub encoding: String,
    pub mtime: i64,
}

/// 바이트 → (글자, 인코딩). 글자 파일이 아니면 None(NUL 이 섞인 이진 파일 등).
pub fn decode_text(b: &[u8]) -> Option<(String, &'static str)> {
    if b.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return std::str::from_utf8(&b[3..]).ok().map(|s| (s.to_string(), "utf-8-bom"));
    }
    if b.starts_with(&[0xFF, 0xFE]) && b.len() % 2 == 0 {
        let u: Vec<u16> = b[2..].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16(&u).ok().map(|s| (s, "utf-16le"));
    }
    if b.iter().take(8192).any(|&x| x == 0) {
        return None;
    }
    if let Ok(s) = std::str::from_utf8(b) {
        return Some((s.to_string(), "utf-8"));
    }
    cp949_decode(b).map(|s| (s, "cp949"))
}

pub fn encode_text(text: &str, enc: &str) -> Result<Vec<u8>, String> {
    match enc {
        "utf-8" => Ok(text.as_bytes().to_vec()),
        "utf-8-bom" => Ok([&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat()),
        "utf-16le" => Ok([0xFFu8, 0xFE].into_iter().chain(text.encode_utf16().flat_map(|u| u.to_le_bytes())).collect()),
        "cp949" => cp949_encode(text),
        _ => Err("알 수 없는 인코딩".into()),
    }
}

#[cfg(windows)]
fn cp949_decode(b: &[u8]) -> Option<String> {
    use windows::Win32::Globalization::{MultiByteToWideChar, MB_ERR_INVALID_CHARS};
    if b.is_empty() {
        return Some(String::new());
    }
    unsafe {
        let n = MultiByteToWideChar(949, MB_ERR_INVALID_CHARS, b, None);
        if n <= 0 {
            return None;
        }
        let mut w = vec![0u16; n as usize];
        let m = MultiByteToWideChar(949, MB_ERR_INVALID_CHARS, b, Some(&mut w));
        if m <= 0 {
            return None;
        }
        String::from_utf16(&w[..m as usize]).ok()
    }
}
#[cfg(windows)]
fn cp949_encode(text: &str) -> Result<Vec<u8>, String> {
    use windows::core::BOOL;
    use windows::Win32::Globalization::{WideCharToMultiByte, WC_NO_BEST_FIT_CHARS};
    let w: Vec<u16> = text.encode_utf16().collect();
    if w.is_empty() {
        return Ok(Vec::new());
    }
    unsafe {
        let mut used = BOOL(0);
        /* WC_NO_BEST_FIT_CHARS: 없는 글자를 '비슷한 글자'(é→e)로 바꾸지 말고 기본 글자로 — 그래야 아래 used 가 서서 거부된다.
           이 깃발이 없으면 글자가 조용히 바뀐 채 저장됐다 */
        let n = WideCharToMultiByte(949, WC_NO_BEST_FIT_CHARS, &w, None, None, Some(&mut used));
        if n <= 0 {
            return Err("EUC-KR 로 바꾸지 못했습니다".into());
        }
        let mut out = vec![0u8; n as usize];
        used = BOOL(0);
        let m = WideCharToMultiByte(949, WC_NO_BEST_FIT_CHARS, &w, Some(&mut out), None, Some(&mut used));
        if m <= 0 {
            return Err("EUC-KR 로 바꾸지 못했습니다".into());
        }
        if used.as_bool() {
            return Err("이 파일의 인코딩(EUC-KR)으로 쓸 수 없는 글자가 있습니다".into());
        }
        out.truncate(m as usize);
        Ok(out)
    }
}
#[cfg(not(windows))]
fn cp949_decode(_b: &[u8]) -> Option<String> {
    None
}
#[cfg(not(windows))]
fn cp949_encode(_t: &str) -> Result<Vec<u8>, String> {
    Err("EUC-KR 은 Windows 에서만".into())
}

pub fn read_text_in(root: &Path, rel: &str) -> Result<TextFile, String> {
    let p = resolve(root, rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("읽을 수 없습니다: {e}"))?;
    if md.is_dir() {
        return Err("폴더입니다".into());
    }
    if md.len() > TEXT_MAX {
        return Err("글자 파일 상한(5MB) 초과".into());
    }
    let b = std::fs::read(&p).map_err(|e| format!("읽을 수 없습니다(다른 프로그램에서 사용 중일 수 있음): {e}"))?;
    let (text, encoding) = decode_text(&b).ok_or_else(|| "글자 파일이 아닙니다".to_string())?;
    Ok(TextFile { text, encoding: encoding.into(), mtime: mtime_ms(&md) })
}

/// 글자 파일 저장 — base_mtime(읽을 때의 고친 시각)과 지금이 다르면 거부한다(다른 프로그램이 그 사이 고쳤음).
/// 같은 폴더의 임시 파일(~$ 로 시작 — 트리에 안 보임)에 쓴 뒤 바꿔치기한다(쓰다 끊겨도 원본이 반쪽이 되지 않게).
pub fn write_text_in(root: &Path, rel: &str, text: &str, encoding: &str, base_mtime: i64) -> Result<i64, String> {
    let p = resolve(root, rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("찾을 수 없습니다: {e}"))?;
    if md.is_dir() {
        return Err("폴더입니다".into());
    }
    if mtime_ms(&md) != base_mtime {
        return Err("다른 프로그램이 이 파일을 고쳤습니다. 다시 열어 주세요".into());
    }
    let cur = std::fs::read(&p).map_err(|e| format!("읽을 수 없습니다: {e}"))?;
    if decode_text(&cur).is_none() {
        return Err("글자 파일이 아닙니다".into());
    }
    let bytes = encode_text(text, encoding)?;
    if bytes.len() as u64 > TEXT_MAX {
        return Err("글자 파일 상한(5MB) 초과".into());
    }
    let name = p.file_name().ok_or_else(|| "이름을 알 수 없습니다".to_string())?.to_string_lossy().into_owned();
    let tmp = p.with_file_name(format!("~${name}.wmhh-tmp"));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("저장하지 못했습니다: {e}"))?;
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("저장하지 못했습니다(다른 프로그램에서 사용 중일 수 있음): {e}"));
    }
    Ok(std::fs::metadata(&p).map(|m| mtime_ms(&m)).unwrap_or(0))
}

/* ── 명령 ───────────────────────────────────────────────────────────── */

/// 문서 폴더들을 한꺼번에 잡는다(화면 순서 = 폴더 번호). 못 여는 폴더는 그 자리만 ok:false.
/// 동기 커맨드는 Tauri 메인(화면) 스레드에서 돈다 — 디스크(특히 공유 폴더)가 느리면 그동안 앱 전체가 멈춘다.
/// 그래서 파일을 만지는 문서 커맨드는 모두 이걸로 별도 스레드에서 돌린다(v3.8.5).
async fn off_main<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn doc_set_roots(paths: Vec<String>) -> Result<Vec<RootInfo>, String> {
    off_main(move || Ok(set_roots(paths))).await
}
pub fn set_roots(paths: Vec<String>) -> Vec<RootInfo> {
    let mut roots = Vec::new();
    let mut out = Vec::new();
    for p in &paths {
        match canon_dir(p) {
            Ok(c) => { out.push(RootInfo { ok: true, path: display(&c), error: String::new() }); roots.push(Some(c)); }
            Err(e) => { out.push(RootInfo { ok: false, path: p.clone(), error: e }); roots.push(None); }
        }
    }
    /* v3.8.9: 폴더를 정하는 순간 찾기 색인을 뒤에서 만들기 시작한다(앱이 켜질 때·폴더를 추가할 때) — 공유 폴더는 한 번 훑는 데
       10초가 넘어, 처음 찾을 때 시작하면 그만큼 기다렸다. 이미 색인이 있거나 만드는 중이면 아무것도 안 한다. 디스크에는 저장하지 않는다(소유자 결정) */
    for c in roots.iter().flatten() {
        let have = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|x| &x.base == c);
        if !have { refresh_later_now(c.clone()); }
    }
    *ROOTS.lock().unwrap_or_else(|e| e.into_inner()) = roots;
    out
}

#[tauri::command]
pub async fn doc_list(root: usize, rel: String) -> Result<Vec<DocEntry>, String> {
    let r = self::root(root)?;
    off_main(move || {
        list_in(&r, &rel)
    }).await
}

/// 파일 내용을 그대로(배열 버퍼로) 돌려준다 — JSON 숫자 배열로 보내면 큰 파일에서 몇 배로 커진다.
#[tauri::command]
pub async fn doc_read(root: usize, rel: String) -> Result<tauri::ipc::Response, String> {
    let r = self::root(root)?;
    Ok(tauri::ipc::Response::new(off_main(move || read_in(&r, &rel)).await?))
}

#[tauri::command]
pub async fn doc_read_text(root: usize, rel: String) -> Result<TextFile, String> {
    let r = self::root(root)?;
    off_main(move || {
        read_text_in(&r, &rel)
    }).await
}

#[tauri::command]
pub async fn doc_write_text(root: usize, rel: String, text: String, encoding: String, base_mtime: i64) -> Result<i64, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = write_text_in(&r, &rel, &text, &encoding, base_mtime);
        if out.is_ok() { patch_search_text(&r, &rel, &text); }   // 색인은 버리지 않고 이 파일만 바꿔 끼운다
        out
    }).await
}

#[tauri::command]
pub async fn doc_move(root: usize, from: String, to_dir: String) -> Result<String, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = move_in(&r, &from, &to_dir);
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

#[tauri::command]
pub async fn doc_import(root: usize, dir: String, paths: Vec<String>, mv: Option<bool>) -> Result<Vec<String>, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = import_in(&r, &dir, &paths, mv.unwrap_or(false));
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

/// 지금 Shift 가 눌려 있나 — 탐색기에서 끌어 오는 동안 웹뷰는 키 입력을 못 받으므로 Windows 에 직접 묻는다
#[tauri::command]
pub fn key_shift_down() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_SHIFT};
        (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0
    }
    #[cfg(not(windows))]
    false
}

/// 복제 — 같은 폴더에 '이름 (2)' 로(폴더는 통째로). 새 rel.
pub fn copy_in(root: &Path, rel: &str) -> Result<String, String> {
    if rel.trim_matches('/').is_empty() {
        return Err("문서 폴더 자체는 복제할 수 없습니다".into());
    }
    let src = resolve_item(root, rel)?;
    let dir = src.parent().ok_or_else(|| "복제할 수 없습니다".to_string())?.to_path_buf();
    let name = src.file_name().ok_or_else(|| "이름을 알 수 없습니다".to_string())?.to_os_string();
    let dest = free_dest(&dir, &name);
    let mut budget: u32 = 20_000;
    copy_tree(&src, &dest, &mut budget).map_err(|e| format!("복제하지 못했습니다: {e}"))?;
    Ok(rel_of(root, &dest))
}

#[tauri::command]
pub async fn doc_copy(root: usize, rel: String) -> Result<String, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = copy_in(&r, &rel);
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

/// 휴지통으로 — 영구 삭제가 아니다(Windows 휴지통에서 되살릴 수 있다)
#[tauri::command]
pub fn doc_trash(root: usize, rel: String) -> Result<(), String> {
    let r = self::root(root)?;
    let out = trash_in(&r, &rel);
    invalidate_search_root(&r);
    out
}

/// 문서 폴더 안 찾기 — 이름(폴더·파일)과 작은 글자 파일의 내용. 무거운 일이라 별도 스레드에서.
#[tauri::command]
pub async fn doc_search(root: usize, query: String) -> Result<Vec<SearchHit>, String> {
    let r = self::root(root)?;
    tauri::async_runtime::spawn_blocking(move || search_cached(&r, &query)).await.map_err(|e| e.to_string())?
}

/// 찾기 칸을 누르면 미리 색인을 만들어 둔다(공유 폴더는 처음 훑는 데 오래 걸린다) — 이미 있으면 아무것도 안 한다
#[tauri::command]
pub async fn doc_search_warm(root: usize) -> Result<(), String> {
    let r = self::root(root)?;
    off_main(move || {
        let base = std::fs::canonicalize(&r).unwrap_or(r);
        let have = SEARCH_CACHE.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|x| x.base == base);
        if !have { refresh_later_now(base); }
        Ok(())
    }).await
}
/// 색인이 아직 없을 때 뒤에서 만든다(refresh_later 는 '있던 색인이 지워졌으면 넣지 않는다' 규칙이라 따로)
fn refresh_later_now(base: PathBuf) {
    {
        let mut r = REFRESHING.lock().unwrap_or_else(|e| e.into_inner());
        if r.contains(&base) { return }
        r.push(base.clone());
    }
    std::thread::spawn(move || {
        let g = search_gen(&base);
        let ix = std::sync::Arc::new(build_index(&base));
        store_index_if(ix, g);   // 만드는 사이 문서가 바뀌었으면 넣지 않는다(예전엔 이 길에 그 확인이 없었다)
        REFRESHING.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| x != &base);
    });
}

#[tauri::command]
pub async fn doc_create_doc(root: usize, dir: String, name: String) -> Result<String, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = create_doc_in(&r, &dir, &name);
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

#[tauri::command]
pub async fn doc_create(root: usize, dir: String, name: String, is_dir: bool) -> Result<String, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = create_in(&r, &dir, &name, is_dir);
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

#[tauri::command]
pub async fn doc_rename(root: usize, rel: String, name: String) -> Result<String, String> {
    let r = self::root(root)?;
    off_main(move || {
        let out = rename_in(&r, &rel, &name);
        invalidate_search_root(&r);   // 바꾼 뒤에, 이 폴더만(실패해도 반쯤 바뀌었을 수 있으니 버린다)
        out
    }).await
}

/// 열기·폴더에서 보기(이미 있는 open_file_path / reveal_file_path)에 넘길 절대 경로 — 역시 문서 폴더 안만.
#[tauri::command]
pub fn doc_abs(root: usize, rel: String) -> Result<String, String> {
    Ok(display(&resolve(&self::root(root)?, &rel)?))
}

/// 탐색기 미리 보기(preview.rs)용 — 문서 폴더 안의 실제 경로
pub fn abs_path(root: usize, rel: &str) -> Result<PathBuf, String> {
    resolve(&self::root(root)?, rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wmhh_docs_{name}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가 폴더/안쪽")).unwrap();
        std::fs::write(d.join("가 폴더/보고서.hwpx"), b"x").unwrap();
        std::fs::write(d.join("~$임시.xlsx"), b"x").unwrap();
        std::fs::write(d.join(".숨김"), b"x").unwrap();
        std::fs::write(d.join("표.xlsx"), b"abc").unwrap();
        d
    }

    #[test]
    fn resolve_rejects_paths_outside_root() {
        let d = tmp("outside");
        let root = d.join("가 폴더");
        assert!(resolve(&root, "").is_ok());
        assert!(resolve(&root, "보고서.hwpx").is_ok());
        assert!(resolve(&root, "안쪽").is_ok());
        for bad in ["..", "../표.xlsx", "안쪽/../../표.xlsx", "..\\표.xlsx", "/etc", "C:/Windows", "C:\\Windows"] {
            assert!(resolve(&root, bad).is_err(), "거부해야 함: {bad}");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    /// `"."`·`"./"` 는 문서 폴더 자체로 풀린다 — 옮기기·이름 바꾸기·복제·휴지통은 이걸 받으면 안 된다
    /// (예전엔 `""` 만 막아서 `"."` 로 문서 폴더 전체를 휴지통에 보내거나, 폴더 밖(부모)에 복제본을 만들 수 있었다).
    #[test]
    fn item_commands_refuse_the_root_itself() {
        let r = tmp("rootself");
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        for rel in ["", ".", "./", "./.", "/", "가 폴더/.."] {
            assert!(resolve_item(&root, rel).is_err(), "거부해야 함: {rel:?}");
            assert!(trash_in(&root, rel).is_err(), "휴지통 거부: {rel:?}");
            assert!(rename_in(&root, rel, "새이름").is_err(), "이름 바꾸기 거부: {rel:?}");
            assert!(copy_in(&root, rel).is_err(), "복제 거부: {rel:?}");
            assert!(move_in(&root, rel, "가 폴더/안쪽").is_err(), "옮기기 거부: {rel:?}");
        }
        assert!(r.exists() && r.join("표.xlsx").exists(), "문서 폴더는 그대로");
        assert!(!r.parent().unwrap().join(format!("{} (2)", r.file_name().unwrap().to_string_lossy())).exists(), "폴더 밖에 복제본이 생기지 않는다");
        assert!(resolve_item(&root, "./가 폴더/보고서.hwpx").is_ok(), "평범한 항목은 그대로 된다");
        let _ = std::fs::remove_dir_all(&r);
    }

    /// 공유 폴더 경로는 `\\?\UNC\…` 로 정규화되는데, 보기용 경로는 `\\서버\공유\…` 여야 열기·휴지통이 된다
    #[test]
    fn display_turns_unc_back_into_a_share_path() {
        assert_eq!(display(Path::new(r"\\?\UNC\srv\공유\가 폴더\a.hwpx")), r"\\srv\공유\가 폴더\a.hwpx");
        assert_eq!(display(Path::new(r"\\?\C:\문서\a.txt")), r"C:\문서\a.txt");
        assert_eq!(display(Path::new(r"C:\문서")), r"C:\문서");
    }

    /// 휴지통이 없는 자리(공유 폴더·이동식·네트워크 드라이브)에서는 Windows 가 경고 없이 영구 삭제하므로 거부한다
    #[test]
    fn trash_refuses_places_without_a_recycle_bin() {
        let fixed = |_: &str| 3u32;
        assert!(trash_place_ok(r"C:\문서\a.txt", fixed).is_ok());
        assert!(trash_place_ok(r"\\srv\공유\a.txt", fixed).is_err(), "공유 폴더");
        assert!(trash_place_ok(r"E:\a.txt", |_| 2).is_err(), "이동식(USB)");
        assert!(trash_place_ok(r"Z:\a.txt", |_| 4).is_err(), "네트워크 드라이브");
        assert!(trash_place_ok(r"R:\a.txt", |_| 6).is_err(), "램 디스크");
        let mut asked = String::new();
        let _ = trash_place_ok(r"D:\깊은\곳\a.txt", |v| { asked = v.to_string(); 3 });
        assert_eq!(asked, r"D:\", "드라이브 뿌리로 묻는다");
    }

    /// 정션(링크)을 따라가 **진짜 폴더**를 바꾸지 않는다 — 문서 폴더 자신을 가리키는 정션이면 폴더 전체가 걸린다.
    #[cfg(windows)]
    #[test]
    fn item_commands_refuse_links() {
        let r = tmp("junction");
        let link = r.join("고리");
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&r).output().map(|o| o.status.success()).unwrap_or(false);
        if !ok { eprintln!("mklink /J 를 못 만들어 건너뜀"); let _ = std::fs::remove_dir_all(&r); return; }
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        assert!(trash_in(&root, "고리").is_err());
        assert!(rename_in(&root, "고리", "딴이름").is_err());
        assert!(copy_in(&root, "고리").is_err());
        assert!(move_in(&root, "고리", "가 폴더").is_err());
        assert!(link.exists() && r.join("표.xlsx").exists(), "정션도 대상 폴더도 그대로");
        let _ = std::fs::remove_dir(&link);   // 정션만 지운다(대상은 안 따라감)
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn list_one_level_dirs_first_and_skip_hidden_temp() {
        let d = tmp("list");
        let got = list_in(&d, "").unwrap();
        let names: Vec<_> = got.iter().map(|e| (e.name.as_str(), e.dir)).collect();
        assert_eq!(names, vec![("가 폴더", true), ("표.xlsx", false)], "폴더 먼저 · 숨김·~$ 임시 파일 제외 · 한 단계만");
        assert_eq!(got[1].size, 3);
        assert!(got[1].mtime > 0);
        let inner = list_in(&d, "가 폴더").unwrap();
        assert_eq!(inner.iter().map(|e| e.rel.as_str()).collect::<Vec<_>>(), vec!["가 폴더/안쪽", "가 폴더/보고서.hwpx"]);
        assert!(list_in(&d, "표.xlsx").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn move_inside_root_only_no_overwrite_no_self() {
        let d = tmp("move");
        std::fs::create_dir_all(d.join("다른")).unwrap();
        assert_eq!(move_in(&d, "표.xlsx", "가 폴더").unwrap(), "가 폴더/표.xlsx");
        assert!(d.join("가 폴더/표.xlsx").exists() && !d.join("표.xlsx").exists());
        assert!(move_in(&d, "가 폴더/표.xlsx", "가 폴더").is_err(), "이미 그 폴더");
        std::fs::write(d.join("다른/표.xlsx"), b"other").unwrap();
        assert!(move_in(&d, "가 폴더/표.xlsx", "다른").is_err(), "같은 이름이 있으면 덮어쓰지 않는다");
        assert_eq!(std::fs::read(d.join("다른/표.xlsx")).unwrap(), b"other");
        assert!(move_in(&d, "가 폴더", "가 폴더/안쪽").is_err(), "자기 안으로");
        assert!(move_in(&d, "", "다른").is_err(), "루트 자체");
        assert!(move_in(&d.join("가 폴더"), "보고서.hwpx", "..").is_err(), "문서 폴더 밖으로");
        assert!(move_in(&d, "가 폴더/보고서.hwpx", "가 폴더/보고서.hwpx").is_err(), "파일 안으로");
        assert_eq!(move_in(&d, "가 폴더/안쪽", "다른").unwrap(), "다른/안쪽", "폴더도 옮긴다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn text_encodings_round_trip_and_conflict_guard() {
        let d = tmp("text");
        std::fs::write(d.join("u8.txt"), "한글 UTF-8".as_bytes()).unwrap();
        std::fs::write(d.join("bom.md"), [&[0xEF, 0xBB, 0xBF][..], "# 제목".as_bytes()].concat()).unwrap();
        std::fs::write(d.join("bin.dat"), [1u8, 0, 2, 3]).unwrap();
        let t = read_text_in(&d, "u8.txt").unwrap();
        assert_eq!((t.text.as_str(), t.encoding.as_str()), ("한글 UTF-8", "utf-8"));
        let b = read_text_in(&d, "bom.md").unwrap();
        assert_eq!((b.text.as_str(), b.encoding.as_str()), ("# 제목", "utf-8-bom"));
        assert!(read_text_in(&d, "bin.dat").is_err(), "이진 파일은 글자 파일이 아니다");
        let m2 = write_text_in(&d, "bom.md", "# 바꾼 제목", "utf-8-bom", b.mtime).unwrap();
        assert_eq!(std::fs::read(d.join("bom.md")).unwrap(), [&[0xEF, 0xBB, 0xBF][..], "# 바꾼 제목".as_bytes()].concat(), "BOM 유지");
        assert!(write_text_in(&d, "bom.md", "x", "utf-8-bom", b.mtime).is_err() || m2 == b.mtime, "옛 시각으로는 덮어쓰지 않는다");
        assert!(write_text_in(&d, "bin.dat", "x", "utf-8", read_text_in(&d, "u8.txt").unwrap().mtime).is_err());
        assert!(!std::fs::read_dir(&d).unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains("wmhh-tmp")), "임시 파일이 남지 않는다");
        let u16b = encode_text("가A", "utf-16le").unwrap();
        assert_eq!(decode_text(&u16b).unwrap(), ("가A".to_string(), "utf-16le"));
        #[cfg(windows)]
        {
            let euc = [0xC7u8, 0xD1, 0xB1, 0xDB]; // "한글" EUC-KR
            assert_eq!(decode_text(&euc).unwrap(), ("한글".to_string(), "cp949"));
            assert_eq!(encode_text("한글", "cp949").unwrap(), euc);
            assert!(encode_text("😀", "cp949").is_err(), "EUC-KR 로 못 쓰는 글자는 거부");
            /* Windows 는 EUC-KR 에 없는 글자를 '비슷한 글자'로 바꿔 쓴다(é→e, ü→u, ñ→n — 실측). 그때는 '못 쓴 글자'
               표시도 안 서서 거부를 그냥 지나갔다 — 저장하면 글자가 조용히 바뀌었다 */
            for t in ["café", "Müller", "España"] {
                assert!(encode_text(t, "cp949").is_err(), "비슷한 글자로 바꿔 쓰지 않고 거부: {t}");
            }
            assert_eq!(decode_text(&encode_text("한글 € Ω ⓐ", "cp949").unwrap()).unwrap().0, "한글 € Ω ⓐ", "EUC-KR 에 있는 글자는 그대로");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn read_inside_root_only() {
        let d = tmp("read");
        assert_eq!(read_in(&d, "표.xlsx").unwrap(), b"abc");
        assert!(read_in(&d.join("가 폴더"), "../표.xlsx").is_err());
        assert!(read_in(&d, "가 폴더").is_err(), "폴더는 읽지 않는다");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn create_and_rename_inside_root_no_overwrite() {
        let r = tmp("create");
        std::fs::create_dir_all(r.join("가")).unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        assert_eq!(create_in(&root, "가", "새 문서.txt", false).unwrap(), "가/새 문서.txt");
        assert!(create_in(&root, "가", "새 문서.txt", false).is_err(), "같은 이름은 거부");
        assert_eq!(create_in(&root, "", "새 폴더", true).unwrap(), "새 폴더");
        for bad in ["a/b", "..", "a:b", "  ", "x.", "CON", "com1.txt", "a?b"] {
            assert!(create_in(&root, "", bad, false).is_err(), "{bad}");
        }
        assert!(create_in(&root, "../", "x.txt", false).is_err(), "밖으로 못 나간다");
        assert_eq!(rename_in(&root, "가/새 문서.txt", "회의.md").unwrap(), "가/회의.md");
        assert!(r.join("가").join("회의.md").exists());
        std::fs::write(r.join("가").join("b.txt"), "b").unwrap();
        assert!(rename_in(&root, "가/b.txt", "회의.md").is_err(), "덮어쓰지 않는다");
        assert_eq!(rename_in(&root, "가/회의.md", "회의.MD").unwrap(), "가/회의.MD", "대소문자만 바꾸기");
        assert!(rename_in(&root, "", "x").is_err());
        assert!(rename_in(&root, "가/b.txt", "../밖.txt").is_err());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn import_copies_in_keeps_original_and_numbers_duplicates() {
        let r = tmp("import");
        let outside = tmp("import_src");
        std::fs::write(outside.join("회의.txt"), "a").unwrap();
        std::fs::create_dir_all(outside.join("묶음/안")).unwrap();
        std::fs::write(outside.join("묶음/안/b.txt"), "b").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        let ps = vec![outside.join("회의.txt").to_string_lossy().to_string(), outside.join("묶음").to_string_lossy().to_string()];
        assert_eq!(import_in(&root, "가 폴더", &ps, false).unwrap(), vec!["가 폴더/회의.txt", "가 폴더/묶음"]);
        assert!(outside.join("회의.txt").exists(), "원본은 그대로(복사)");
        assert_eq!(std::fs::read_to_string(r.join("가 폴더/묶음/안/b.txt")).unwrap(), "b", "폴더는 통째로");
        assert_eq!(import_in(&root, "가 폴더", &ps[..1], false).unwrap(), vec!["가 폴더/회의 (2).txt"], "같은 이름은 (2)");
        let me = vec![r.join("가 폴더").to_string_lossy().to_string()];
        assert!(import_in(&root, "가 폴더/안쪽", &me, false).is_err(), "자기 안으로는 못 넣는다");
        assert!(import_in(&root, "../", &ps, false).is_err());
        let _ = std::fs::remove_dir_all(&r);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn new_office_docs_are_real_zip_files_not_empty() {
        let r = tmp("newdoc");
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        for (n, magic) in [("새 한글.hwpx", "PK"), ("새 표.xlsx", "PK"), ("새 발표.pptx", "PK")] {
            let rel = create_doc_in(&root, "가 폴더", n).unwrap();
            let b = std::fs::read(r.join(&rel)).unwrap();
            assert!(b.len() > 1000 && b.starts_with(magic.as_bytes()), "{n}: {} 바이트", b.len());
        }
        assert!(create_doc_in(&root, "가 폴더", "새 한글.hwpx").is_err(), "덮어쓰지 않는다");
        assert!(create_doc_in(&root, "", "x.zzz").is_err(), "모르는 형식은 거부");
        assert!(builtin_blank("hwpx").is_some() && builtin_blank("txt").is_none());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn import_move_takes_original_away() {
        let r = tmp("importmv");
        let outside = tmp("importmv_src");
        std::fs::write(outside.join("옮길.txt"), "m").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        let ps = vec![outside.join("옮길.txt").to_string_lossy().to_string()];
        assert_eq!(import_in(&root, "가 폴더", &ps, true).unwrap(), vec!["가 폴더/옮길.txt"]);
        assert!(!outside.join("옮길.txt").exists(), "옮기면 원본은 없다");
        assert_eq!(std::fs::read_to_string(r.join("가 폴더/옮길.txt")).unwrap(), "m");
        let _ = std::fs::remove_dir_all(&r);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn search_names_and_small_text_contents_skip_hidden() {
        let r = tmp("search");
        std::fs::write(r.join("가 폴더/회의록 11월.txt"), "안건 없음").unwrap();
        std::fs::write(r.join("가 폴더/안쪽/메모.md"), "첫 줄\n견적서 회신 기한은 11.28 까지\n").unwrap();
        std::fs::write(r.join("가 폴더/안쪽/표.csv"), "이름,견적\n").unwrap();
        std::fs::write(r.join(".숨김견적"), "견적").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        let hits = search_in(&root, "견적").unwrap();
        let mut got: Vec<(String, String)> = hits.iter().map(|h| (h.rel.clone(), h.hit.clone())).collect();
        got.sort();
        assert_eq!(got, vec![("가 폴더/안쪽/메모.md".into(), "text".into()), ("가 폴더/안쪽/표.csv".into(), "text".into())]);
        assert!(hits.iter().find(|h| h.rel.ends_with("메모.md")).unwrap().snippet.contains("견적서 회신"));
        assert_eq!(search_in(&root, "11월").unwrap()[0].hit, "name");
        assert_eq!(search_in(&root, "안쪽").unwrap()[0].dir, true, "폴더 이름도 찾는다");
        assert!(search_in(&root, "  ").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn search_waits_for_in_progress_build_instead_of_walking_twice() {
        let r = tmp("search-wait");
        std::fs::write(r.join("가 폴더/기다림.txt"), "x").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        invalidate_search_root(&root);
        REFRESHING.lock().unwrap().push(root.clone());              // 다른 스레드가 만드는 중인 척
        let ready = root.clone();
        let h = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            /* 그 사이 생긴 파일까지 든 '미리 만든' 색인을 넣고 끝났다고 알린다 — 찾기가 직접 훑었다면 이 파일 이름은 안 보인다 */
            let g = search_gen(&ready);
            let mut ix = build_index(&ready);
            ix.ents.push(IdxEntry { rel: "가 폴더/미리만든표시".into(), name: "미리만든표시".into(), low: "미리만든표시".into(), dir: false, text: None });
            store_index_if(std::sync::Arc::new(ix), g);
            REFRESHING.lock().unwrap().retain(|x| x != &ready);
        });
        let hits = search_cached(&root, "미리만든").unwrap();
        h.join().unwrap();
        assert_eq!(hits.len(), 1, "미리 만들던 색인을 기다렸다가 썼다");
        invalidate_search_root(&root);
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn search_cache_reused_until_invalidated() {
        let r = tmp("search-cache");
        std::fs::write(r.join("가 폴더/첫.txt"), "x").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        invalidate_search_root(&root);
        assert_eq!(search_cached(&root, "첫").unwrap().len(), 1);
        std::fs::write(r.join("가 폴더/둘째첫.txt"), "x").unwrap();   // 앱 밖에서 생긴 파일 — 색인을 다시 쓰므로 아직 안 보인다
        assert_eq!(search_cached(&root, "첫").unwrap().len(), 1);
        invalidate_search_root(&root);                                // 앱이 문서를 바꾸면 버린다
        assert_eq!(search_cached(&root, "첫").unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(&r);
    }

    /// 글자 파일을 저장하면 색인을 버리지 않고 그 파일 내용만 바꿔 끼운다 — 고치는 동안(1.2초마다 저장) 찾기가
    /// 폴더를 처음부터 다시 훑지 않게. 앱 밖에서 생긴 파일이 안 보이는 것이 '다시 훑지 않았다'는 증거다.
    #[test]
    fn saving_text_patches_the_index_instead_of_dropping_it() {
        let r = tmp("search-patch");
        std::fs::write(r.join("가 폴더/메모.txt"), "처음").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        invalidate_search_root(&root);
        assert_eq!(search_cached(&root, "고친말").unwrap().len(), 0);
        std::fs::write(r.join("가 폴더/몰래.txt"), "고친말").unwrap();   // 앱 밖에서 생김 — 다시 훑으면 보인다
        let m = read_text_in(&root, "가 폴더/메모.txt").unwrap();
        write_text_in(&root, "가 폴더/메모.txt", "고친말 들어감", &m.encoding, m.mtime).unwrap();
        patch_search_text(&root, "가 폴더/메모.txt", "고친말 들어감");
        let hits = search_cached(&root, "고친말").unwrap();
        assert_eq!(hits.iter().map(|h| h.rel.as_str()).collect::<Vec<_>>(), vec!["가 폴더/메모.txt"], "고친 내용은 바로 찾히고, 다시 훑지는 않았다");
        invalidate_search_root(&root);
        let _ = std::fs::remove_dir_all(&r);
    }

    /// 한 문서 폴더를 바꾸면 그 폴더 색인만 버린다(예전엔 모든 폴더 — 다른 공유 폴더도 처음부터 다시 훑었다)
    #[test]
    fn invalidating_one_root_keeps_other_roots() {
        let a = tmp("search-root-a");
        let b = tmp("search-root-b");
        let (ra, rb) = (canon_dir(&a.to_string_lossy()).unwrap(), canon_dir(&b.to_string_lossy()).unwrap());
        search_cached(&ra, "표").unwrap();
        search_cached(&rb, "표").unwrap();
        invalidate_search_root(&ra);
        let have = |p: &Path| SEARCH_CACHE.lock().unwrap().iter().any(|x| x.base == p);
        assert!(!have(&ra), "바꾼 폴더는 버린다");
        assert!(have(&rb), "다른 폴더는 그대로");
        invalidate_search_root(&rb);
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    /// 만드는 도중 그 폴더가 바뀌면 다 만든 색인을 넣지 않는다(낡은 색인 다시 넣기 방지)
    #[test]
    fn index_built_before_a_change_is_not_stored() {
        let r = tmp("search-gen");
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        let g = search_gen(&root);
        let ix = std::sync::Arc::new(build_index(&root));
        invalidate_search_root(&root);                                // 그 사이 앱이 이 폴더를 바꿨다
        assert!(!store_index_if(ix, g), "바뀌기 전에 훑은 색인은 넣지 않는다");
        let g2 = search_gen(&root);
        assert!(store_index_if(std::sync::Arc::new(build_index(&root)), g2), "바뀐 뒤에 훑은 것은 넣는다");
        invalidate_search_root(&root);
        let _ = std::fs::remove_dir_all(&r);
    }

    /// 실제 Windows 휴지통에 시험 파일을 넣으므로 평소엔 건너뛴다: `cargo test --lib -- --ignored trash`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn trash_inside_root_only() {
        let r = tmp("trash");
        std::fs::write(r.join("가 폴더/버릴.txt"), "x").unwrap();
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        assert!(trash_in(&root, "").is_err(), "문서 폴더 자체는 못 지운다");
        assert!(trash_in(&root, "../밖").is_err());
        trash_in(&root, "가 폴더/버릴.txt").unwrap();
        assert!(!r.join("가 폴더/버릴.txt").exists());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn copy_makes_numbered_sibling() {
        let r = tmp("copy");
        let root = canon_dir(&r.to_string_lossy()).unwrap();
        assert_eq!(copy_in(&root, "가 폴더/보고서.hwpx").unwrap(), "가 폴더/보고서 (2).hwpx");
        assert_eq!(copy_in(&root, "가 폴더/보고서.hwpx").unwrap(), "가 폴더/보고서 (3).hwpx");
        assert_eq!(copy_in(&root, "가 폴더").unwrap(), "가 폴더 (2)");
        assert!(r.join("가 폴더 (2)/보고서 (3).hwpx").exists(), "폴더는 통째로");
        assert!(copy_in(&root, "").is_err());
        let _ = std::fs::remove_dir_all(&r);
    }

    #[test]
    fn doc_protocol_serves_only_inside_roots() {
        assert_eq!(percent_decode("%EA%B0%80%20a%2Bb.html"), "가 a+b.html");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(mime_of(Path::new("x.HTML")), "text/html; charset=utf-8");
        assert_eq!(mime_of(Path::new("x.zzz")), "application/octet-stream");
        assert!(serve_path("/x/a.html").is_err(), "폴더 번호가 숫자가 아니면 거부");
        assert!(serve_path("/999/a.html").is_err(), "없는 폴더 번호");
        assert!(serve_path("nopath").is_err());
    }
}