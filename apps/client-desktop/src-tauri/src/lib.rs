mod utils;

use db::{NewPerson, Person, PersonWithDetails};
use leapsake_core::{Contact, ContactFormat, JSContactData, NewContactData, VCardData};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};
use utils::get_contacts_dir;

// Database state wrapped in Mutex for thread-safe access
struct Database(Mutex<Connection>);

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

// Database commands (new people-focused API)

#[command]
async fn db_create_person(
    db: State<'_, Database>,
    person: NewPerson,
    emails: Vec<(String, Option<String>)>,
    phones: Vec<(String, Option<String>, Option<Vec<String>>)>,
    addresses: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::create_person(&conn, person, emails, phones, addresses).map_err(|e| e.to_string())
}

#[command]
async fn db_read_person(db: State<'_, Database>, person_id: String) -> Result<Option<PersonWithDetails>, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::read_person(&conn, &person_id).map_err(|e| e.to_string())
}

#[command]
async fn db_update_person(db: State<'_, Database>, person_id: String, person: NewPerson) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::update_person(&conn, &person_id, person).map_err(|e| e.to_string())
}

#[command]
async fn db_delete_person(db: State<'_, Database>, person_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::delete_person(&conn, &person_id).map_err(|e| e.to_string())
}

#[command]
async fn db_list_people(db: State<'_, Database>) -> Result<Vec<Person>, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::list_people(&conn).map_err(|e| e.to_string())
}

#[command]
async fn db_search_people(db: State<'_, Database>, query: String) -> Result<Vec<Person>, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::search_people(&conn, &query).map_err(|e| e.to_string())
}

#[command]
async fn db_add_email(
    db: State<'_, Database>,
    person_id: String,
    email: String,
    label: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::add_email(&conn, &person_id, &email, label.as_deref()).map_err(|e| e.to_string())
}

#[command]
async fn db_delete_email(db: State<'_, Database>, email_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::delete_email(&conn, &email_id).map_err(|e| e.to_string())
}

#[command]
async fn db_add_phone(
    db: State<'_, Database>,
    person_id: String,
    number: String,
    label: Option<String>,
    features: Option<Vec<String>>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::add_phone(&conn, &person_id, &number, label.as_deref(), features).map_err(|e| e.to_string())
}

#[command]
async fn db_delete_phone(db: State<'_, Database>, phone_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::delete_phone(&conn, &phone_id).map_err(|e| e.to_string())
}

#[command]
async fn db_add_address(
    db: State<'_, Database>,
    person_id: String,
    street: String,
    locality: Option<String>,
    region: Option<String>,
    postcode: Option<String>,
    country: Option<String>,
    label: Option<String>,
) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::add_address(
        &conn,
        &person_id,
        &street,
        locality.as_deref(),
        region.as_deref(),
        postcode.as_deref(),
        country.as_deref(),
        label.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[command]
async fn db_delete_address(db: State<'_, Database>, address_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| format!("Database lock error: {}", e))?;
    db::delete_address(&conn, &address_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("Failed to create app data directory");

            let db_path = app_data_dir.join("leapsake.db");
            let conn = Connection::open(&db_path)
                .expect("Failed to open database");

            // Run migrations
            db::run_migrations(&conn)
                .expect("Failed to run database migrations");

            // Store connection in app state
            app.manage(Database(Mutex::new(conn)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // File-based commands (kept for import/export compatibility)
            browse_contacts,
            browse_contacts_all,
            browse_vcards,
            add_contact,
            read_contact,
            edit_contact,
            delete_contact,
            convert_contact,
            // Database commands (new people-focused API)
            db_create_person,
            db_read_person,
            db_update_person,
            db_delete_person,
            db_list_people,
            db_search_people,
            db_add_email,
            db_delete_email,
            db_add_phone,
            db_delete_phone,
            db_add_address,
            db_delete_address,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
