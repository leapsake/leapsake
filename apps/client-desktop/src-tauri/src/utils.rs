use tauri::{AppHandle, Manager};
use std::path::PathBuf;

pub fn get_contacts_dir(app: AppHandle) -> Result<PathBuf, String> {
    let app_data = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let contacts_dir = app_data.join("contacts");

    std::fs::create_dir_all(&contacts_dir)
        .map_err(|e| format!("Failed to create contacts directory: {}", e))?;

    Ok(contacts_dir)
}
