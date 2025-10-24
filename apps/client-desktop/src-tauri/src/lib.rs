use tauri::{command, AppHandle, Manager};
use leapsake_core::{JSContactData};

#[command]
async fn get_contacts(app: AppHandle, path: Option<String>) -> Result<Vec<JSContactData>, String> {
    let contacts_dir = if let Some(custom_path) = path {
        // Use custom path if provided
        std::path::PathBuf::from(custom_path)
    } else {
        // Default to app_data/contacts if no path provided
        let app_data = app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        app_data.join("contacts")
    };

    leapsake_core::get_contacts(&[contacts_dir])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_contacts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
