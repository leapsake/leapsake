use std::fs;
use std::path::{Path, PathBuf};
use crate::utils::get_files_with;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(serde::Serialize, Clone, Debug)]
pub struct JSContactData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

pub fn browse_contacts<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<JSContactData>, String> {
    // Create directories if they don't exist
    for dir in contact_dirs {
        let dir = dir.as_ref();
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
        }
    }

    // Get all .jscontact files and transform them into JSContactData
    let callback = |path: &PathBuf| -> Result<JSContactData, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

        Ok(JSContactData {
            content,
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.to_string_lossy().to_string(),
        })
    };

    let contact_results: Vec<Result<JSContactData, String>> =
        get_files_with(contact_dirs, Some(&["jscontact"]), callback)?;

    // Collect results, propagating any errors
    contact_results.into_iter().collect()
}

/// Data for creating a new contact
#[derive(serde::Deserialize, Debug)]
pub struct NewContactData {
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<String>,
    pub anniversary: Option<String>,
}

/// Parsed contact data ready for display
#[derive(serde::Serialize, Clone, Debug)]
pub struct Contact {
    pub uid: String,
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<String>,
    pub anniversary: Option<String>,
    pub file_path: String,
}

/// Adds a new contact as a .jscontact file
///
/// # Arguments
/// * `contact_dir` - Directory where the contact file will be created
/// * `data` - Contact data to save
///
/// # Returns
/// * `Result<String, String>` - Path to the created file, or error message
///
/// # Behavior
/// * Creates the directory if it doesn't exist
/// * Generates filename as FamilyName-GivenName-UUID.jscontact (omitting missing parts)
/// * Creates JSContact v1.0 compliant JSON file
pub fn add_contact<P: AsRef<Path>>(
    contact_dir: P,
    data: NewContactData,
) -> Result<String, String> {
    let dir = contact_dir.as_ref();

    // Create directory if it doesn't exist
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
    }

    // Generate UUID for the contact
    let contact_uuid = Uuid::new_v4();

    // Build filename: FamilyName-GivenName-UUID.jscontact (omit missing parts)
    let mut filename_parts = Vec::new();

    if let Some(ref family_name) = data.family_name {
        if !family_name.is_empty() {
            filename_parts.push(family_name.replace(' ', "-"));
        }
    }

    if let Some(ref given_name) = data.given_name {
        if !given_name.is_empty() {
            filename_parts.push(given_name.replace(' ', "-"));
        }
    }

    filename_parts.push(contact_uuid.to_string());
    let filename = format!("{}.jscontact", filename_parts.join("-"));

    // Build JSContact JSON structure (RFC 9553)
    let mut jscontact = json!({
        "@type": "Card",
        "version": "1.0",
        "uid": format!("urn:uuid:{}", contact_uuid),
    });

    // Add name components if any name fields are present
    let mut name_components = Vec::new();

    if let Some(ref given_name) = data.given_name {
        if !given_name.is_empty() {
            name_components.push(json!({
                "kind": "given",
                "value": given_name
            }));
        }
    }

    if let Some(ref middle_name) = data.middle_name {
        if !middle_name.is_empty() {
            name_components.push(json!({
                "kind": "given2",
                "value": middle_name
            }));
        }
    }

    if let Some(ref family_name) = data.family_name {
        if !family_name.is_empty() {
            name_components.push(json!({
                "kind": "surname",
                "value": family_name
            }));
        }
    }

    if !name_components.is_empty() {
        jscontact["name"] = json!({
            "components": name_components,
            "isOrdered": true
        });
    }

    // Add anniversaries if present (birthday and/or anniversary)
    let mut anniversaries = serde_json::Map::new();

    if let Some(ref birthday) = data.birthday {
        if !birthday.is_empty() {
            anniversaries.insert(
                "birthday".to_string(),
                json!({
                    "@type": "Anniversary",
                    "kind": "birth",
                    "date": birthday
                })
            );
        }
    }

    if let Some(ref anniversary) = data.anniversary {
        if !anniversary.is_empty() {
            anniversaries.insert(
                "anniversary".to_string(),
                json!({
                    "@type": "Anniversary",
                    "kind": "wedding",
                    "date": anniversary
                })
            );
        }
    }

    if !anniversaries.is_empty() {
        jscontact["anniversaries"] = Value::Object(anniversaries);
    }

    // Convert to pretty-printed JSON string
    let json_content = serde_json::to_string_pretty(&jscontact)
        .map_err(|e| format!("Failed to serialize JSContact: {}", e))?;

    // Write file
    let file_path = dir.join(&filename);
    fs::write(&file_path, json_content)
        .map_err(|e| format!("Failed to write contact file: {}", e))?;

    // Return the path as a string
    Ok(file_path.to_string_lossy().to_string())
}

/// Gets a single contact by UUID
///
/// # Arguments
/// * `contact_dir` - Directory where contact files are stored
/// * `uuid` - UUID to search for (without urn:uuid: prefix)
///
/// # Returns
/// * `Result<Contact, String>` - Parsed contact data, or error message
///
/// # Behavior
/// * Fast path: Searches filenames for UUID match (regex pattern)
/// * Slow path: If not found in filename, parses all JSContact files and matches by UID
pub fn read_contact<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
) -> Result<Contact, String> {
    let dir = contact_dir.as_ref();

    if !dir.exists() {
        return Err(format!("Contacts directory does not exist: {}", dir.display()));
    }

    // Get all .jscontact files
    let files = get_files_with(&[dir], Some(&["jscontact"]), |path: &PathBuf| path.clone())?;

    // Fast path: Find file with UUID in filename
    let uuid_lower = uuid.to_lowercase();
    let matching_file = files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
    });

    if let Some(file_path) = matching_file {
        return parse_contact_file(file_path);
    }

    // Slow path: Parse all files and match by UID
    for file_path in &files {
        if let Ok(contact) = parse_contact_file(file_path) {
            // Extract UUID from UID (handle both "urn:uuid:..." and plain UUID formats)
            let contact_uuid = contact.uid
                .strip_prefix("urn:uuid:")
                .unwrap_or(&contact.uid)
                .to_lowercase();

            if contact_uuid == uuid_lower {
                return Ok(contact);
            }
        }
    }

    Err(format!("Contact not found with UUID: {}", uuid))
}

/// Helper function to parse a JSContact file into a Contact struct
fn parse_contact_file(file_path: &Path) -> Result<Contact, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Extract UID (required field)
    let uid = json["uid"]
        .as_str()
        .ok_or("Missing uid field")?
        .to_string();

    // Extract name components
    let mut given_name = None;
    let mut middle_name = None;
    let mut family_name = None;

    if let Some(name_obj) = json.get("name") {
        // Check for structured components format
        if let Some(components) = name_obj.get("components").and_then(|c| c.as_array()) {
            for component in components {
                if let (Some(kind), Some(value)) = (
                    component.get("kind").and_then(|k| k.as_str()),
                    component.get("value").and_then(|v| v.as_str()),
                ) {
                    match kind {
                        "given" => given_name = Some(value.to_string()),
                        "given2" => middle_name = Some(value.to_string()),
                        "surname" => family_name = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }
        // Fall back to "full" name format if components not present
        else if let Some(full_name) = name_obj.get("full").and_then(|f| f.as_str()) {
            // Parse "FirstName LastName" or "FirstName MiddleName LastName" format
            let parts: Vec<&str> = full_name.split_whitespace().collect();
            match parts.len() {
                1 => {
                    given_name = Some(parts[0].to_string());
                }
                2 => {
                    given_name = Some(parts[0].to_string());
                    family_name = Some(parts[1].to_string());
                }
                3 => {
                    given_name = Some(parts[0].to_string());
                    middle_name = Some(parts[1].to_string());
                    family_name = Some(parts[2].to_string());
                }
                _ if !parts.is_empty() => {
                    // For 4+ parts, treat first as given, last as surname, rest as middle
                    given_name = Some(parts[0].to_string());
                    family_name = Some(parts[parts.len() - 1].to_string());
                    if parts.len() > 2 {
                        middle_name = Some(parts[1..parts.len() - 1].join(" "));
                    }
                }
                _ => {}
            }
        }
    }

    // Extract anniversaries
    let mut birthday = None;
    let mut anniversary = None;

    if let Some(anniversaries_obj) = json.get("anniversaries").and_then(|a| a.as_object()) {
        for (_key, value) in anniversaries_obj {
            if let Some(kind) = value.get("kind").and_then(|k| k.as_str()) {
                if let Some(date) = value.get("date").and_then(|d| d.as_str()) {
                    match kind {
                        "birth" => birthday = Some(date.to_string()),
                        "wedding" => anniversary = Some(date.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(Contact {
        uid,
        given_name,
        middle_name,
        family_name,
        birthday,
        anniversary,
        file_path: file_path.to_string_lossy().to_string(),
    })
}
