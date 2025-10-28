use tauri::{command, AppHandle, Manager};
use leapsake_core::{JSContactData, NewContactData, Contact};

#[command]
async fn browse_contacts(app: AppHandle, path: Option<String>) -> Result<Vec<JSContactData>, String> {
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

    leapsake_core::browse_contacts(&[contacts_dir])
}

#[command]
async fn add_contact(app: AppHandle, path: Option<String>, data: NewContactData) -> Result<String, String> {
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

    leapsake_core::add_contact(contacts_dir, data)
}

#[command]
async fn read_contact(app: AppHandle, path: Option<String>, uuid: String) -> Result<Contact, String> {
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

    leapsake_core::read_contact(contacts_dir, &uuid)
}

#[command]
async fn edit_contact(app: AppHandle, path: Option<String>, uuid: String, data: NewContactData) -> Result<String, String> {
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

    leapsake_core::edit_contact(contacts_dir, &uuid, data)
}

#[command]
async fn delete_contact(app: AppHandle, path: Option<String>, uuid: String) -> Result<(), String> {
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

    leapsake_core::delete_contact(contacts_dir, &uuid)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![browse_contacts, add_contact, read_contact, edit_contact, delete_contact])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
