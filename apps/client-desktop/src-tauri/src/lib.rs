use tauri::{command, AppHandle, Manager};
use leapsake_core::{get_vcards_from_directory, VCardData};

#[command]
async fn get_vcards(app: AppHandle) -> Result<Vec<VCardData>, String> {
    let app_data = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let contacts_dir = app_data.join("contacts");

    get_vcards_from_directory(&contacts_dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_vcards])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
