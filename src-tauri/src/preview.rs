//! v3.8.1 문서 탭 — 탐색기 미리 보기 창(Windows 미리 보기 처리기, IPreviewHandler).
//!
//! 탐색기의 '미리 보기 창'과 같은 부품을 메인 창 안에 띄운다. 한컴·MS Office·Adobe 등
//! 설치된 프로그램이 등록해 둔 처리기를 그대로 빌리므로, 그 프로그램이 그리는 모습 그대로다.
//! 처리기가 없는 형식은 false 를 돌려주고 화면이 JS 미리 보기로 대신한다.
//!
//! - COM 개체는 스레드를 넘을 수 없으므로 모든 작업을 메인(UI) 스레드에서 한다
//!   (`run_on_main_thread` + 채널). 그래서 커맨드는 `async` 여야 한다 — 동기 커맨드는
//!   메인 스레드에서 돌아 채널을 기다리는 순간 교착된다.
//! - 위치는 웹뷰 안의 자리(물리 px)를 화면이 알려 준다. 미리 보기 창은 웹뷰 위에 뜨는
//!   별도 창이라, 팝업이 열리면 화면이 숨김을 요청한다(`doc_preview_show(false)`).

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;

    use tauri::{AppHandle, Manager};
    use windows::core::{w, Interface, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::System::Com::{CoCreateInstance, CLSIDFromString, CLSCTX_INPROC_SERVER, CLSCTX_LOCAL_SERVER, IStream, STGM_READ};
    use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithFile, IInitializeWithStream};
    use windows::Win32::UI::Shell::{
        AssocQueryStringW, IInitializeWithItem, IPreviewHandler, IShellItem, SHCreateItemFromParsingName,
        SHCreateStreamOnFileEx, ASSOCF_INIT_DEFAULTTOSTAR, ASSOCF_NOTRUNCATE, ASSOCSTR_SHELLEXTENSION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNA,
        WINDOW_EX_STYLE, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
    };

    /// 미리 보기 처리기 인터페이스 id — 확장자의 shellex 아래 이 키에 처리기 CLSID 가 있다.
    const IID_PREVIEW: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";

    struct Live {
        handler: IPreviewHandler,
        host: HWND,
    }

    thread_local! {
        // 메인 스레드 전용. 한 번에 하나만 띄운다.
        static LIVE: RefCell<Option<Live>> = const { RefCell::new(None) };
    }

    /// 확장자에 등록된 미리 보기 처리기 CLSID. ProgID·SystemFileAssociations·인지 형식(perceived)
    /// 까지 거슬러 찾는 것은 셸의 연결 조회(AssocQueryString)가 해 준다.
    pub fn handler_clsid(path: &Path) -> Option<String> {
        let ext = path.extension()?.to_str()?;
        let ext = HSTRING::from(format!(".{ext}"));
        let extra = HSTRING::from(IID_PREVIEW);
        let mut buf = [0u16; 128];
        let mut n = buf.len() as u32;
        let hr = unsafe {
            AssocQueryStringW(
                ASSOCF_INIT_DEFAULTTOSTAR | ASSOCF_NOTRUNCATE,
                ASSOCSTR_SHELLEXTENSION,
                PCWSTR(ext.as_ptr()),
                PCWSTR(extra.as_ptr()),
                Some(PWSTR(buf.as_mut_ptr())),
                &mut n,
            )
        };
        if hr.is_err() {
            return None;
        }
        let s = String::from_utf16_lossy(&buf[..(n as usize).saturating_sub(1)]);
        let s = s.trim_matches(char::from(0)).trim().to_string();
        if s.starts_with('{') { Some(s) } else { None }
    }

    fn rect(w: i32, h: i32) -> RECT {
        RECT { left: 0, top: 0, right: w.max(1), bottom: h.max(1) }
    }

    unsafe fn init_handler(h: &IPreviewHandler, path: &Path) -> windows::core::Result<()> {
        let p = HSTRING::from(path.as_os_str());
        if let Ok(f) = h.cast::<IInitializeWithFile>() {
            if f.Initialize(PCWSTR(p.as_ptr()), STGM_READ.0).is_ok() {
                return Ok(());
            }
        }
        if let Ok(i) = h.cast::<IInitializeWithItem>() {
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(p.as_ptr()), None)?;
            if i.Initialize(&item, STGM_READ.0).is_ok() {
                return Ok(());
            }
        }
        let s = h.cast::<IInitializeWithStream>()?;
        let st: IStream = SHCreateStreamOnFileEx(PCWSTR(p.as_ptr()), STGM_READ.0, 0, false, None)?;
        s.Initialize(&st, STGM_READ.0)
    }

    fn close_live() {
        LIVE.with(|l| {
            if let Some(v) = l.borrow_mut().take() {
                unsafe {
                    let _ = v.handler.Unload();
                    let _ = DestroyWindow(v.host);
                }
            }
        });
    }

    /// 메인 스레드에서 처리기를 만들어 붙인다. 실패하면 남은 것을 모두 치운다.
    fn open_on_main(parent: HWND, path: &Path, clsid: &str, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
        close_live();
        unsafe {
            let id = CLSIDFromString(&HSTRING::from(clsid)).map_err(|e| e.to_string())?;
            // 처리기 대부분은 별도 프로세스(prevhost.exe)에서 돈다 — 처리기가 죽어도 앱은 산다.
            let handler: IPreviewHandler = CoCreateInstance(&id, None, CLSCTX_LOCAL_SERVER)
                .or_else(|_| CoCreateInstance(&id, None, CLSCTX_INPROC_SERVER))
                .map_err(|e| format!("미리 보기 처리기를 만들 수 없습니다 ({e})"))?;
            init_handler(&handler, path).map_err(|e| format!("미리 보기 처리기가 파일을 열지 못했습니다 ({e})"))?;
            let host = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!(""),
                WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
                x, y, w.max(1), h.max(1),
                Some(parent), None, None, None,
            )
            .map_err(|e| e.to_string())?;
            let _ = SetWindowPos(host, Some(HWND_TOP), x, y, w.max(1), h.max(1), SWP_NOACTIVATE);
            let _ = ShowWindow(host, SW_SHOWNA);
            let r = rect(w, h);
            let res = handler.SetWindow(host, &r).and_then(|_| handler.DoPreview());
            if let Err(e) = res {
                let _ = handler.Unload();
                let _ = DestroyWindow(host);
                return Err(format!("미리 보기를 그리지 못했습니다 ({e})"));
            }
            LIVE.with(|l| *l.borrow_mut() = Some(Live { handler, host }));
        }
        Ok(())
    }

    /// 메인 스레드에서 f 를 돌리고 결과를 기다린다.
    fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&AppHandle) -> T + Send + 'static) -> Result<T, String> {
        let (tx, rx) = mpsc::channel();
        let a = app.clone();
        app.run_on_main_thread(move || {
            let _ = tx.send(f(&a));
        })
        .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(20)).map_err(|_| "미리 보기 응답이 없습니다".to_string())
    }

    fn main_hwnd(app: &AppHandle) -> Result<HWND, String> {
        let w = app.get_webview_window("main").ok_or("메인 창이 없습니다")?;
        let h = w.hwnd().map_err(|e| e.to_string())?;
        Ok(HWND(h.0 as _))
    }

    pub fn open(app: &AppHandle, path: std::path::PathBuf, x: i32, y: i32, w: i32, h: i32) -> Result<bool, String> {
        let Some(clsid) = handler_clsid(&path) else {
            let _ = on_main(app, |_| close_live());
            return Ok(false);
        };
        on_main(app, move |a| {
            let parent = main_hwnd(a)?;
            open_on_main(parent, &path, &clsid, x, y, w, h)
        })??;
        Ok(true)
    }

    pub fn place(app: &AppHandle, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
        on_main(app, move |_| {
            LIVE.with(|l| {
                if let Some(v) = l.borrow().as_ref() {
                    unsafe {
                        let _ = SetWindowPos(v.host, Some(HWND_TOP), x, y, w.max(1), h.max(1), SWP_NOACTIVATE);
                        let _ = v.handler.SetRect(&rect(w, h));
                    }
                }
            })
        })
    }

    pub fn show(app: &AppHandle, on: bool) -> Result<(), String> {
        on_main(app, move |_| {
            LIVE.with(|l| {
                if let Some(v) = l.borrow().as_ref() {
                    unsafe {
                        let _ = ShowWindow(v.host, if on { SW_SHOWNA } else { SW_HIDE });
                    }
                }
            })
        })
    }

    pub fn close(app: &AppHandle) -> Result<(), String> {
        on_main(app, |_| close_live())
    }
}

use tauri::AppHandle;

/// 처리기가 있으면 띄우고 true, 없으면 false(화면이 JS 미리 보기로 대신한다).
#[tauri::command]
pub async fn doc_preview_open(app: AppHandle, root: usize, rel: String, x: i32, y: i32, w: i32, h: i32) -> Result<bool, String> {
    let path = crate::docs::abs_path(root, &rel)?;
    if !path.is_file() {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        imp::open(&app, path, x, y, w, h)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, x, y, w, h);
        Ok(false)
    }
}

#[tauri::command]
pub async fn doc_preview_place(app: AppHandle, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::place(&app, x, y, w, h)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, x, y, w, h);
        Ok(())
    }
}

#[tauri::command]
pub async fn doc_preview_show(app: AppHandle, on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::show(&app, on)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, on);
        Ok(())
    }
}

#[tauri::command]
pub async fn doc_preview_close(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::close(&app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn finds_registered_text_previewer_or_none() {
        // .txt 는 Windows 기본 텍스트 미리 보기가 있다. 없는 확장자는 None.
        let none = super::imp::handler_clsid(std::path::Path::new("a.zzzqqq"));
        assert!(none.is_none());
        if let Some(c) = super::imp::handler_clsid(std::path::Path::new("a.txt")) {
            assert!(c.starts_with('{') && c.ends_with('}'), "{c}");
        }
    }
}
