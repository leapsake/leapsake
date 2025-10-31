mod utils;

use tauri::{command, AppHandle};
use leapsake_core::{JSContactData, NewContactData, Contact};
use utils::get_contacts_dir;

#[command]
async fn browse_contacts(app: AppHandle) -> Result<Vec<JSContactData>, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::browse_contacts(&[contacts_dir])
}

#[command]
async fn add_contact(app: AppHandle, data: NewContactData) -> Result<String, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::add_contact(contacts_dir, data)
}

#[command]
async fn read_contact(app: AppHandle, uuid: String) -> Result<Contact, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::read_contact(contacts_dir, &uuid)
}

#[command]
async fn edit_contact(app: AppHandle, uuid: String, data: NewContactData) -> Result<String, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::edit_contact(contacts_dir, &uuid, data)
}

#[command]
async fn delete_contact(app: AppHandle, uuid: String) -> Result<(), String> {
    let contacts_dir = get_contacts_dir(app)?;

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
