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

pub fn get_contacts<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<JSContactData>, String> {
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
