mod utils;

use leapsake_core::{Contact, ContactFormat, JSContactData, NewContactData, VCardData};
use tauri::{AppHandle, command};
use utils::get_contacts_dir;

#[command]
async fn browse_contacts(app: AppHandle) -> Result<Vec<JSContactData>, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::browse_contacts(&[contacts_dir])
}

#[command]
async fn add_contact(
    app: AppHandle,
    data: NewContactData,
    format: Option<String>,
) -> Result<String, String> {
    let contacts_dir = get_contacts_dir(app)?;

    let contact_format = match format.as_deref() {
        Some("vcard") | Some("vcf") => ContactFormat::VCard,
        Some("jscontact") | None => ContactFormat::JSContact,
        Some(other) => return Err(format!("Unknown format: {}", other)),
    };

    leapsake_core::add_contact_with_format(contacts_dir, data, contact_format)
}

#[command]
async fn read_contact(app: AppHandle, uuid: String) -> Result<Contact, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::read_contact(contacts_dir, &uuid)
}

#[command]
async fn edit_contact(
    app: AppHandle,
    uuid: String,
    data: NewContactData,
) -> Result<String, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::edit_contact_preserve_format(contacts_dir, &uuid, data)
}

#[command]
async fn delete_contact(app: AppHandle, uuid: String) -> Result<(), String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::delete_contact(contacts_dir, &uuid)
}

#[command]
async fn browse_contacts_all(app: AppHandle) -> Result<Vec<Contact>, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::browse_contacts_all(&[contacts_dir])
}

#[command]
async fn browse_vcards(app: AppHandle) -> Result<Vec<VCardData>, String> {
    let contacts_dir = get_contacts_dir(app)?;

    leapsake_core::browse_vcards(&[contacts_dir])
}

#[command]
async fn convert_contact(
    app: AppHandle,
    uuid: String,
    target_format: String,
) -> Result<String, String> {
    let contacts_dir = get_contacts_dir(app)?;

    let format = match target_format.as_str() {
        "vcard" | "vcf" => ContactFormat::VCard,
        "jscontact" => ContactFormat::JSContact,
        _ => return Err(format!("Unknown format: {}", target_format)),
    };

    leapsake_core::convert_contact_format(contacts_dir, &uuid, format)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            browse_contacts,
            browse_contacts_all,
            browse_vcards,
            add_contact,
            read_contact,
            edit_contact,
            delete_contact,
            convert_contact
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
