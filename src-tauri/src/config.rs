use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Name of the dedicated subfolder created under whatever *location* the
/// user picks (first-run dialog or the 저장 위치 button) — e.g. picking
/// "D:\" results in "D:\뭐하려했더라_데이터\". The user only ever points at
/// a location, never at a specific empty folder; our own subfolder is
/// always created fresh so it can't collide with pre-existing files.
/// (v3.0.0 rename: existing installs are unaffected — config.json stores the
/// absolute data_dir path, and this constant is only used when creating a
/// NEW folder on first run or via the 저장 위치 button.)
pub const DATA_FOLDER_NAME: &str = "뭐하려했더라_데이터";

/// Tiny app-level config, kept deliberately separate from the SQLite
/// database it points at (a chicken-and-egg problem otherwise: we need to
/// know where the DB is *before* we can open it). Lives at a fixed,
/// well-known location (`app_config_dir()`), unlike the DB itself which
/// this file lets the user relocate.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// User-chosen folder to hold `data/wmhh.sqlite` + `backups/`.
    /// None means "use the default app-local-data folder".
    pub data_dir: Option<String>,
    /// Set together with a new `data_dir` by `choose_data_dir`: the folder
    /// the data still physically lives in until the move is applied. The
    /// actual file copy happens at the START of the next launch (see
    /// lib.rs), not at choose time — copying at choose time snapshotted the
    /// DB and then silently dropped every edit the user made between
    /// choosing and restarting.
    #[serde(default)]
    pub pending_move_from: Option<String>,
}

fn config_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("config.json")
}

fn backup_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("config.json.bak")
}

fn read_cfg(p: &Path) -> Option<AppConfig> {
    fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// config.json 이 깨졌으면(쓰는 도중 전원이 꺼진 경우 등) 직전 것(config.json.bak)을 쓴다.
/// 예전엔 깨지면 바로 기본값 = **데이터 폴더를 잊은 상태**로 켜져, 데이터가 사라진 것처럼 보였다.
pub fn load(app_config_dir: &Path) -> AppConfig {
    read_cfg(&config_path(app_config_dir))
        .or_else(|| read_cfg(&backup_path(app_config_dir)))
        .unwrap_or_default()
}

/// 새 내용을 임시 파일에 다 쓴 뒤 이름을 바꿔 넣는다 — 쓰는 도중 꺼져도 config.json 은 옛것이거나 새것이지 반쪽이 아니다.
/// 다 바꾼 뒤 같은 내용을 .bak 에도 둔다 — 나중에 config.json 이 깨져도 마지막으로 저장한 값(지금 데이터 폴더)으로 켜진다.
pub fn save(app_config_dir: &Path, cfg: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    let path = config_path(app_config_dir);
    let tmp = app_config_dir.join("config.json.tmp");
    fs::write(&tmp, &json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    let _ = fs::write(backup_path(app_config_dir), json);   // 실패해도 저장은 된 것
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_is_whole_and_load_falls_back_to_previous_when_broken() {
        let d = std::env::temp_dir().join(format!("wmhh_test_cfg_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let a = AppConfig { data_dir: Some("D:\\가".into()), pending_move_from: None };
        save(&d, &a).unwrap();
        assert_eq!(load(&d).data_dir.as_deref(), Some("D:\\가"));
        let b = AppConfig { data_dir: Some("E:\\나".into()), pending_move_from: None };
        save(&d, &b).unwrap();
        assert_eq!(load(&d).data_dir.as_deref(), Some("E:\\나"));
        assert!(!d.join("config.json.tmp").exists());
        // 반쯤 쓴 config.json → 마지막으로 저장한 값(.bak)
        fs::write(d.join("config.json"), "{\"data_dir\": \"E:\\\\").unwrap();
        assert_eq!(load(&d).data_dir.as_deref(), Some("E:\\나"));
        // 둘 다 없으면 기본값(예전과 같다)
        let _ = fs::remove_dir_all(&d);
        assert!(load(&d).data_dir.is_none());
    }
}
