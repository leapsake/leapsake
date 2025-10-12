use tauri::{command, AppHandle, Manager};
use std::fs;
use std::path::PathBuf;

#[command]
async fn get_vcards(app: AppHandle) -> Result<Vec<VCardData>, String> {
    let app_data = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let contacts_dir = app_data.join("contacts");

    if !contacts_dir.exists() {
        fs::create_dir_all(&contacts_dir)
            .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
    }

    let entries = fs::read_dir(&contacts_dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut vcards = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("vcf") {
            let content = fs::read_to_string(&path)
                .map_err(|e| e.to_string())?;

            vcards.push(VCardData {
                content,
                file_name: path
                    .to_string_lossy()
                    .rsplit('/').next().unwrap_or("")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(vcards)
}

#[derive(serde::Serialize)]
struct VCardData {
    content: String,
    file_name: String,
    path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_vcards])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
