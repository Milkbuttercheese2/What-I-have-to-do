// 몇 조항이더라 — Tauri 셸.
//
// 프론트엔드(web/)는 그 자체로 완결된 정적 사이트다. Tauri 는 그걸 창에 띄우고,
// 별표 원본 PDF(web/annex/*.pdf)를 same-origin 으로 서빙한다.
//
// 추가로 **전역 핫키(Ctrl+Shift+Space)** 를 등록한다 — 다른 창을 쓰는 도중에도
// 눌러 이 앱을 앞으로 불러오고 검색창에 바로 커서를 둔다(맥 Spotlight 식 빠른 검색).
// 핫키를 받으면 창을 show/focus 하고 프론트엔드에 "spotlight" 이벤트를 보내 검색창을 포커스한다.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 전역 핫키는 데스크톱 전용이다(모바일엔 개념이 없다).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .setup(|_app| {
            #[cfg(desktop)]
            {
                use tauri::{Emitter, Manager};
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                // Ctrl+Shift+Space — 앱을 앞으로 불러오는 빠른 검색 호출.
                let hotkey = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
                _app.global_shortcut().on_shortcut(hotkey, move |app, _sc, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            // 프론트엔드가 이 이벤트를 받아 검색창에 커서를 둔다.
                            let _ = win.emit("spotlight", ());
                        }
                    }
                })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("몇 조항이더라 실행 중 오류");
}
