// 몇 조항이더라 — Tauri 셸.
//
// 프론트엔드(web/)는 그 자체로 완결된 정적 사이트다. Tauri 는 그걸 창에 띄우고,
// 별표 원본 PDF(web/annex/*.pdf)를 same-origin 으로 서빙하는 역할만 한다.
// 그래서 Rust 쪽은 최소한이다 — 네이티브 명령이 필요해지면 여기에 #[tauri::command] 를 더한다.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("몇 조항이더라 실행 중 오류");
}
