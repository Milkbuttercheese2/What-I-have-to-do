/* v3.8.25 보안 2차 — 앱 명령을 창별로 나눈다.
   예전(`tauri_build::build()`)엔 앱 명령 권한이 따로 없어 **모든 창이 모든 명령**을 부를 수 있었다.
   여기 적은 명령마다 `allow-<명령>` 권한이 생기고, 권한을 받지 않은 창은 그 명령을 못 부른다:
   - capabilities/default.json(main 창) = 전부
   - capabilities/capture.json(빠른 메모 창) = 미니 창이 쓰는 다섯 개만
   ⚠️ lib.rs `generate_handler!` 에 명령을 더하면 **여기와 default.json 에도** 더할 것 — 빠뜨리면 화면에서 그 명령이 거부된다.
   시험(tests/unit/capabilities.test.js)이 세 목록이 맞는지 본다. */
const COMMANDS: &[&str] = &[
    "load_all", "save_all", "save_fields", "save_presets", "save_id_kinds", "save_settings", "save_phonebook",
    "doc_set_roots", "doc_read_text", "doc_write_text", "doc_list", "doc_read", "doc_abs", "doc_move", "doc_create",
    "doc_create_doc", "doc_import", "doc_trash", "doc_copy", "doc_search", "doc_search_warm", "key_shift_down",
    "doc_rename", "doc_rename_root", "doc_preview_open", "doc_preview_place", "doc_preview_show", "doc_preview_close",
    "phonebook_search", "phonebook_list", "backup_export", "backup_import", "get_data_dir", "choose_data_dir",
    "restart_app", "quit_now", "emergency_dump", "focus_main_window", "alarm_attention", "save_text_file",
    "save_binary_file", "import_backup_file", "cancel_pending_import", "pick_file_path", "pick_folder_path",
    "open_file_path", "reveal_file_path", "quick_search", "resize_capture", "set_capture_form_mode", "set_ui_scale",
    "set_autostart", "client_log",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build 실패");
}
