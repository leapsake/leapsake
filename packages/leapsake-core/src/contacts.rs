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

#[derive(serde::Serialize, Clone, Debug)]
pub struct VCardData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, Clone, Copy, PartialEq)]
pub enum ContactFormat {
    JSContact,
    VCard,
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

/// Represents a partial date according to JSContact RFC 9553 section 2.8.1
///
/// A PartialDate represents calendar dates in the Gregorian calendar system.
/// All fields are optional, allowing representation of:
/// - Complete dates (year, month, day)
/// - Year only
/// - Month in year (year + month)
/// - Day in month (month + day)
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct PartialDate {
    /// Must be "PartialDate" if specified
    #[serde(rename = "@type", skip_serializing_if = "Option::is_none")]
    pub type_: Option<String>,

    /// The calendar year value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,

    /// The calendar month (1-12). If set, either year or day must also be present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month: Option<u32>,

    /// The calendar day (1-31, depending on month/year validity). Requires month to be set.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day: Option<u32>,
}

/// Email address data
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct EmailAddress {
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Phone number data
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct PhoneNumber {
    pub number: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<Vec<String>>,
}

/// Address data
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct Address {
    pub street: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub postcode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Data for creating a new contact
#[derive(serde::Deserialize, Debug)]
pub struct NewContactData {
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<PartialDate>,
    pub anniversary: Option<PartialDate>,
    pub emails: Option<Vec<EmailAddress>>,
    pub phones: Option<Vec<PhoneNumber>>,
    pub addresses: Option<Vec<Address>>,
    pub photo: Option<String>,
    pub organization: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub note: Option<String>,
}

/// Parsed contact data ready for display
#[derive(serde::Serialize, Clone, Debug)]
pub struct Contact {
    pub uid: String,
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<PartialDate>,
    pub anniversary: Option<PartialDate>,
    pub emails: Option<Vec<EmailAddress>>,
    pub phones: Option<Vec<PhoneNumber>>,
    pub addresses: Option<Vec<Address>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub file_path: String,
}

/// Helper function to build filename from contact data and UUID
///
/// # Arguments
/// * `family_name` - Optional family name
/// * `given_name` - Optional given name
/// * `uuid` - UUID for the contact
/// * `extension` - File extension (e.g., "jscontact" or "vcf")
///
/// # Returns
/// * Filename in format: FamilyName-GivenName-UUID.{extension} (omitting missing name parts)
fn build_contact_filename(
    family_name: Option<&str>,
    given_name: Option<&str>,
    uuid: &str,
    extension: &str,
) -> String {
    let mut filename_parts = Vec::new();

    if let Some(family_name) = family_name {
        if !family_name.is_empty() {
            filename_parts.push(family_name.replace(' ', "-"));
        }
    }

    if let Some(given_name) = given_name {
        if !given_name.is_empty() {
            filename_parts.push(given_name.replace(' ', "-"));
        }
    }

    filename_parts.push(uuid.to_string());
    format!("{}.{}", filename_parts.join("-"), extension)
}

/// Helper function to build JSContact JSON structure from contact data
///
/// # Arguments
/// * `uid` - Full UID in format "urn:uuid:..."
/// * `data` - Contact data
///
/// # Returns
/// * JSContact JSON Value
fn build_jscontact_json(uid: &str, data: &NewContactData) -> Value {
    let mut jscontact = json!({
        "@type": "Card",
        "version": "1.0",
        "uid": uid,
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
        // Only include if at least one date component is present
        if birthday.year.is_some() || birthday.month.is_some() || birthday.day.is_some() {
            let birthday_value = serde_json::to_value(birthday)
                .expect("Failed to serialize PartialDate");

            anniversaries.insert(
                "birthday".to_string(),
                json!({
                    "@type": "Anniversary",
                    "kind": "birth",
                    "date": birthday_value
                })
            );
        }
    }

    if let Some(ref anniversary) = data.anniversary {
        // Only include if at least one date component is present
        if anniversary.year.is_some() || anniversary.month.is_some() || anniversary.day.is_some() {
            let anniversary_value = serde_json::to_value(anniversary)
                .expect("Failed to serialize PartialDate");

            anniversaries.insert(
                "anniversary".to_string(),
                json!({
                    "@type": "Anniversary",
                    "kind": "wedding",
                    "date": anniversary_value
                })
            );
        }
    }

    if !anniversaries.is_empty() {
        jscontact["anniversaries"] = Value::Object(anniversaries);
    }

    // Add emails if present
    if let Some(emails) = &data.emails {
        if !emails.is_empty() {
            let mut emails_map = serde_json::Map::new();

            for (index, email_data) in emails.iter().enumerate() {
                let key = format!("email{}", index + 1);
                let mut email_obj = json!({
                    "@type": "EmailAddress",
                    "email": email_data.email
                });

                if let Some(label) = &email_data.label {
                    if !label.is_empty() {
                        email_obj["label"] = json!(label);
                    }
                }

                emails_map.insert(key, email_obj);
            }

            jscontact["emails"] = Value::Object(emails_map);
        }
    }

    // Add phones if present
    if let Some(phones) = &data.phones {
        if !phones.is_empty() {
            let mut phones_map = serde_json::Map::new();

            for (index, phone_data) in phones.iter().enumerate() {
                let key = format!("phone{}", index + 1);
                let mut phone_obj = json!({
                    "@type": "Phone",
                    "phone": phone_data.number
                });

                if let Some(label) = &phone_data.label {
                    if !label.is_empty() {
                        phone_obj["label"] = json!(label);
                    }
                }

                if let Some(features) = &phone_data.features {
                    if !features.is_empty() {
                        phone_obj["features"] = json!(features);
                    }
                }

                phones_map.insert(key, phone_obj);
            }

            jscontact["phones"] = Value::Object(phones_map);
        }
    }

    // Add addresses if present
    if let Some(addresses) = &data.addresses {
        if !addresses.is_empty() {
            let mut addresses_map = serde_json::Map::new();

            for (index, address_data) in addresses.iter().enumerate() {
                let key = format!("address{}", index + 1);
                let mut address_obj = json!({
                    "@type": "Address",
                    "street": address_data.street
                });

                if let Some(locality) = &address_data.locality.as_ref().filter(|s| !s.is_empty()) {
                    address_obj["locality"] = json!(locality);
                }

                if let Some(region) = &address_data.region.as_ref().filter(|s| !s.is_empty()) {
                    address_obj["region"] = json!(region);
                }

                if let Some(postcode) = &address_data.postcode.as_ref().filter(|s| !s.is_empty()) {
                    address_obj["postcode"] = json!(postcode);
                }

                if let Some(country) = &address_data.country.as_ref().filter(|s| !s.is_empty()) {
                    address_obj["country"] = json!(country);
                }

                if let Some(label) = &address_data.label.as_ref().filter(|s| !s.is_empty()) {
                    address_obj["label"] = json!(label);
                }

                addresses_map.insert(key, address_obj);
            }

            jscontact["addresses"] = Value::Object(addresses_map);
        }
    }

    // Add photo if present
    if let Some(ref photo) = data.photo {
        if !photo.is_empty() {
            jscontact["photos"] = json!({
                "photo1": {
                    "@type": "File",
                    "href": photo
                }
            });
        }
    }

    // Add organization if present
    if let Some(ref org) = data.organization {
        if !org.is_empty() {
            jscontact["organizations"] = json!({
                "org1": {
                    "@type": "Organization",
                    "name": org
                }
            });
        }
    }

    // Add job title if present
    if let Some(ref title) = data.title {
        if !title.is_empty() {
            jscontact["jobTitles"] = json!({
                "title1": {
                    "@type": "JobTitle",
                    "name": title
                }
            });
        }
    }

    // Add URL if present
    if let Some(ref url) = data.url {
        if !url.is_empty() {
            jscontact["onlineServices"] = json!({
                "url1": {
                    "@type": "OnlineService",
                    "uri": url
                }
            });
        }
    }

    // Add note if present
    if let Some(ref note) = data.note {
        if !note.is_empty() {
            jscontact["notes"] = json!({
                "note1": {
                    "@type": "Note",
                    "note": note
                }
            });
        }
    }

    jscontact
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
    let uuid_str = contact_uuid.to_string();
    let uid = format!("urn:uuid:{}", uuid_str);

    // Build filename using helper
    let filename = build_contact_filename(
        data.family_name.as_deref(),
        data.given_name.as_deref(),
        &uuid_str,
        "jscontact",
    );

    // Build JSContact JSON structure using helper
    let jscontact = build_jscontact_json(&uid, &data);

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

/// Updates an existing contact
///
/// # Arguments
/// * `contact_dir` - Directory where contact files are stored
/// * `uuid` - UUID of the contact to update (without urn:uuid: prefix)
/// * `data` - New contact data
///
/// # Returns
/// * `Result<String, String>` - Path to the updated file, or error message
///
/// # Behavior
/// * Finds the existing contact file by UUID
/// * Preserves the UUID from the existing contact
/// * Renames file if family_name or given_name changes
/// * Updates the contact data while preserving other fields from original file
/// * Returns error if contact is not found or update fails, maintaining original file
pub fn edit_contact<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
    data: NewContactData,
) -> Result<String, String> {
    let dir = contact_dir.as_ref();

    if !dir.exists() {
        return Err(format!("Contacts directory does not exist: {}", dir.display()));
    }

    // Find the existing contact file
    let files = get_files_with(&[dir], Some(&["jscontact"]), |path: &PathBuf| path.clone())?;

    let uuid_lower = uuid.to_lowercase();
    let existing_file = files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
    });

    let old_file_path = if let Some(file_path) = existing_file {
        file_path.clone()
    } else {
        // Try slow path - parse all files
        let mut found_path = None;
        for file_path in &files {
            if let Ok(contact) = parse_contact_file(file_path) {
                let contact_uuid = contact.uid
                    .strip_prefix("urn:uuid:")
                    .unwrap_or(&contact.uid)
                    .to_lowercase();

                if contact_uuid == uuid_lower {
                    found_path = Some(file_path.clone());
                    break;
                }
            }
        }
        found_path.ok_or_else(|| format!("Contact not found with UUID: {}", uuid))?
    };

    // Read and parse the existing file to get the UID and other preserved fields
    let existing_content = fs::read_to_string(&old_file_path)
        .map_err(|e| format!("Failed to read existing contact file: {}", e))?;

    let existing_json: Value = serde_json::from_str(&existing_content)
        .map_err(|e| format!("Failed to parse existing contact JSON: {}", e))?;

    // Extract the UID (must preserve the exact UID)
    let uid = existing_json["uid"]
        .as_str()
        .ok_or("Existing contact missing uid field")?
        .to_string();

    // Build new JSContact JSON structure using the existing UID
    let mut new_jscontact = build_jscontact_json(&uid, &data);

    // Preserve any other fields from the original file that we're not managing
    // (like @context, created, updated, etc.)
    if let Some(obj) = existing_json.as_object() {
        let new_obj = new_jscontact.as_object_mut().unwrap();
        for (key, value) in obj {
            // Only preserve fields we don't explicitly manage
            if !matches!(key.as_str(), "@type" | "version" | "uid" | "name" | "anniversaries" | "emails" | "phones" | "addresses" | "photos" | "organizations" | "jobTitles" | "onlineServices" | "notes") {
                new_obj.insert(key.clone(), value.clone());
            }
        }
    }

    // Convert to pretty-printed JSON string
    let json_content = serde_json::to_string_pretty(&new_jscontact)
        .map_err(|e| format!("Failed to serialize updated JSContact: {}", e))?;

    // Build new filename
    let uuid_only = uid.strip_prefix("urn:uuid:").unwrap_or(&uid);
    let new_filename = build_contact_filename(
        data.family_name.as_deref(),
        data.given_name.as_deref(),
        uuid_only,
        "jscontact",
    );
    let new_file_path = dir.join(&new_filename);

    // If filename changed, we need to rename; otherwise just update in place
    if old_file_path != new_file_path {
        // Write to new file first
        fs::write(&new_file_path, &json_content)
            .map_err(|e| format!("Failed to write updated contact file: {}", e))?;

        // Only delete old file if new file was written successfully
        fs::remove_file(&old_file_path)
            .map_err(|e| {
                // If deletion fails, try to clean up the new file
                let _ = fs::remove_file(&new_file_path);
                format!("Failed to remove old contact file: {}", e)
            })?;
    } else {
        // Same filename, just overwrite
        fs::write(&new_file_path, json_content)
            .map_err(|e| format!("Failed to update contact file: {}", e))?;
    }

    Ok(new_file_path.to_string_lossy().to_string())
}

/// Deletes an existing contact
///
/// # Arguments
/// * `contact_dir` - Directory where contact files are stored
/// * `uuid` - UUID of the contact to delete (without urn:uuid: prefix)
///
/// # Returns
/// * `Result<(), String>` - Success or error message
///
/// # Behavior
/// * Finds the existing contact file by UUID
/// * Checks if file exists before attempting deletion
/// * Deletes the .jscontact file
/// * Returns error if contact is not found or deletion fails
pub fn delete_contact<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
) -> Result<(), String> {
    let dir = contact_dir.as_ref();

    if !dir.exists() {
        return Err(format!("Contacts directory does not exist: {}", dir.display()));
    }

    // Find the existing contact file
    let files = get_files_with(&[dir], Some(&["jscontact"]), |path: &PathBuf| path.clone())?;

    let uuid_lower = uuid.to_lowercase();
    let existing_file = files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
    });

    let file_path = if let Some(file_path) = existing_file {
        file_path.clone()
    } else {
        // Try slow path - parse all files
        let mut found_path = None;
        for file_path in &files {
            if let Ok(contact) = parse_contact_file(file_path) {
                let contact_uuid = contact.uid
                    .strip_prefix("urn:uuid:")
                    .unwrap_or(&contact.uid)
                    .to_lowercase();

                if contact_uuid == uuid_lower {
                    found_path = Some(file_path.clone());
                    break;
                }
            }
        }
        found_path.ok_or_else(|| format!("Contact not found with UUID: {}", uuid))?
    };

    // Check if file exists before attempting deletion
    if !file_path.exists() {
        return Err(format!("Contact file does not exist: {}", file_path.display()));
    }

    // Delete the file
    fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete contact file: {}", e))?;

    Ok(())
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

/// Adds a new contact as a .vcf file
///
/// # Arguments
/// * `contact_dir` - Directory where the vCard file will be created
/// * `data` - Contact data to save
///
/// # Returns
/// * `Result<String, String>` - Path to the created file, or error message
///
/// # Behavior
/// * Creates the directory if it doesn't exist
/// * Generates filename as FamilyName-GivenName-UUID.vcf (omitting missing parts)
/// * Creates vCard 4.0 compliant file
pub fn add_vcard<P: AsRef<Path>>(
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
    let uuid_str = contact_uuid.to_string();
    let uid = format!("urn:uuid:{}", uuid_str);

    // Build filename using helper
    let filename = build_contact_filename(
        data.family_name.as_deref(),
        data.given_name.as_deref(),
        &uuid_str,
        "vcf",
    );

    // Build vCard string using helper
    let vcard_content = build_vcard(&uid, &data)?;

    // Write file
    let file_path = dir.join(&filename);
    fs::write(&file_path, vcard_content)
        .map_err(|e| format!("Failed to write vCard file: {}", e))?;

    // Return the path as a string
    Ok(file_path.to_string_lossy().to_string())
}

/// Updates an existing vCard contact
///
/// # Arguments
/// * `contact_dir` - Directory where vCard files are stored
/// * `uuid` - UUID of the contact to update (without urn:uuid: prefix)
/// * `data` - New contact data
///
/// # Returns
/// * `Result<String, String>` - Path to the updated file, or error message
///
/// # Behavior
/// * Finds the existing vCard file by UUID
/// * Preserves the UUID from the existing contact
/// * Renames file if family_name or given_name changes
/// * Updates the contact data
/// * Returns error if contact is not found or update fails, maintaining original file
pub fn edit_vcard<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
    data: NewContactData,
) -> Result<String, String> {
    let dir = contact_dir.as_ref();

    if !dir.exists() {
        return Err(format!("Contacts directory does not exist: {}", dir.display()));
    }

    // Find the existing vCard file
    let files = get_files_with(&[dir], Some(&["vcf"]), |path: &PathBuf| path.clone())?;

    let uuid_lower = uuid.to_lowercase();
    let existing_file = files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
    });

    let old_file_path = if let Some(file_path) = existing_file {
        file_path.clone()
    } else {
        // Try slow path - parse all vCard files
        let mut found_path = None;
        for file_path in &files {
            if let Ok(contact) = parse_vcard_file(file_path) {
                let contact_uuid = contact.uid
                    .strip_prefix("urn:uuid:")
                    .unwrap_or(&contact.uid)
                    .to_lowercase();

                if contact_uuid == uuid_lower {
                    found_path = Some(file_path.clone());
                    break;
                }
            }
        }
        found_path.ok_or_else(|| format!("vCard contact not found with UUID: {}", uuid))?
    };

    // Read the existing file to get the UID
    let existing_contact = parse_vcard_file(&old_file_path)?;
    let uid = existing_contact.uid;

    // Build new vCard content
    let vcard_content = build_vcard(&uid, &data)?;

    // Build new filename
    let uuid_only = uid.strip_prefix("urn:uuid:").unwrap_or(&uid);
    let new_filename = build_contact_filename(
        data.family_name.as_deref(),
        data.given_name.as_deref(),
        uuid_only,
        "vcf",
    );
    let new_file_path = dir.join(&new_filename);

    // If filename changed, we need to rename; otherwise just update in place
    if old_file_path != new_file_path {
        // Write to new file first
        fs::write(&new_file_path, &vcard_content)
            .map_err(|e| format!("Failed to write updated vCard file: {}", e))?;

        // Only delete old file if new file was written successfully
        fs::remove_file(&old_file_path)
            .map_err(|e| {
                // If deletion fails, try to clean up the new file
                let _ = fs::remove_file(&new_file_path);
                format!("Failed to remove old vCard file: {}", e)
            })?;
    } else {
        // Same filename, just overwrite
        fs::write(&new_file_path, vcard_content)
            .map_err(|e| format!("Failed to update vCard file: {}", e))?;
    }

    Ok(new_file_path.to_string_lossy().to_string())
}

/// Browse vCard contacts (returns raw vCard file content)
pub fn browse_vcards<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<VCardData>, String> {
    // Create directories if they don't exist
    for dir in contact_dirs {
        let dir = dir.as_ref();
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
        }
    }

    // Get all .vcf files and transform them into VCardData
    let callback = |path: &PathBuf| -> Result<VCardData, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

        Ok(VCardData {
            content,
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string(),
            path: path.to_string_lossy().to_string(),
        })
    };

    let vcard_results: Vec<Result<VCardData, String>> =
        get_files_with(contact_dirs, Some(&["vcf"]), callback)?;

    // Collect results, propagating any errors
    vcard_results.into_iter().collect()
}

/// Browse all contacts (both JSContact and vCard formats)
///
/// Returns parsed Contact structs from both .jscontact and .vcf files
pub fn browse_contacts_all<P: AsRef<Path>>(contact_dirs: &[P]) -> Result<Vec<Contact>, String> {
    // Create directories if they don't exist
    for dir in contact_dirs {
        let dir = dir.as_ref();
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("Failed to create contacts directory: {}", e))?;
        }
    }

    let mut contacts = Vec::new();

    // Parse .jscontact files
    let jscontact_callback = |path: &PathBuf| -> Result<Contact, String> {
        parse_contact_file(path)
    };
    let jscontact_results: Vec<Result<Contact, String>> =
        get_files_with(contact_dirs, Some(&["jscontact"]), jscontact_callback)?;
    contacts.extend(jscontact_results.into_iter().collect::<Result<Vec<_>, _>>()?);

    // Parse .vcf files
    let vcard_callback = |path: &PathBuf| -> Result<Contact, String> {
        parse_vcard_file(path)
    };
    let vcard_results: Vec<Result<Contact, String>> =
        get_files_with(contact_dirs, Some(&["vcf"]), vcard_callback)?;
    contacts.extend(vcard_results.into_iter().collect::<Result<Vec<_>, _>>()?);

    Ok(contacts)
}

/// Add a contact with the specified format
///
/// # Arguments
/// * `contact_dir` - Directory where the contact file will be created
/// * `data` - Contact data to save
/// * `format` - Format to use (JSContact or VCard)
///
/// # Returns
/// * `Result<String, String>` - Path to the created file, or error message
pub fn add_contact_with_format<P: AsRef<Path>>(
    contact_dir: P,
    data: NewContactData,
    format: ContactFormat,
) -> Result<String, String> {
    match format {
        ContactFormat::JSContact => add_contact(contact_dir, data),
        ContactFormat::VCard => add_vcard(contact_dir, data),
    }
}

/// Detect contact format by file extension
fn detect_format(path: &Path) -> Result<ContactFormat, String> {
    match path.extension().and_then(|s| s.to_str()) {
        Some("jscontact") => Ok(ContactFormat::JSContact),
        Some("vcf") | Some("vcard") => Ok(ContactFormat::VCard),
        Some(ext) => Err(format!("Unknown contact format: {}", ext)),
        None => Err("No file extension".to_string()),
    }
}

/// Read a contact and determine its format
///
/// # Returns
/// * `Result<(Contact, ContactFormat), String>` - Contact and its format, or error
pub fn read_contact_with_format<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
) -> Result<(Contact, ContactFormat), String> {
    let dir = contact_dir.as_ref();

    if !dir.exists() {
        return Err(format!("Contacts directory does not exist: {}", dir.display()));
    }

    // Try JSContact first
    let jscontact_files = get_files_with(&[dir], Some(&["jscontact"]), |path: &PathBuf| path.clone())?;
    let uuid_lower = uuid.to_lowercase();

    for file_path in &jscontact_files {
        if file_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
        {
            let contact = parse_contact_file(file_path)?;
            return Ok((contact, ContactFormat::JSContact));
        }
    }

    // Slow path for JSContact: parse all and match by UID
    for file_path in &jscontact_files {
        if let Ok(contact) = parse_contact_file(file_path) {
            let contact_uuid = contact.uid
                .strip_prefix("urn:uuid:")
                .unwrap_or(&contact.uid)
                .to_lowercase();

            if contact_uuid == uuid_lower {
                return Ok((contact, ContactFormat::JSContact));
            }
        }
    }

    // Try vCard
    let vcard_files = get_files_with(&[dir], Some(&["vcf"]), |path: &PathBuf| path.clone())?;

    for file_path in &vcard_files {
        if file_path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_lowercase().contains(&uuid_lower))
            .unwrap_or(false)
        {
            let contact = parse_vcard_file(file_path)?;
            return Ok((contact, ContactFormat::VCard));
        }
    }

    // Slow path for vCard: parse all and match by UID
    for file_path in &vcard_files {
        if let Ok(contact) = parse_vcard_file(file_path) {
            let contact_uuid = contact.uid
                .strip_prefix("urn:uuid:")
                .unwrap_or(&contact.uid)
                .to_lowercase();

            if contact_uuid == uuid_lower {
                return Ok((contact, ContactFormat::VCard));
            }
        }
    }

    Err(format!("Contact not found with UUID: {}", uuid))
}

/// Edit a contact while preserving its original format
///
/// # Arguments
/// * `contact_dir` - Directory where contact files are stored
/// * `uuid` - UUID of the contact to update
/// * `data` - New contact data
///
/// # Returns
/// * `Result<String, String>` - Path to the updated file, or error message
pub fn edit_contact_preserve_format<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
    data: NewContactData,
) -> Result<String, String> {
    let (_, format) = read_contact_with_format(&contact_dir, uuid)?;

    match format {
        ContactFormat::JSContact => edit_contact(contact_dir, uuid, data),
        ContactFormat::VCard => edit_vcard(contact_dir, uuid, data),
    }
}

/// Convert a contact from one format to another
///
/// # Arguments
/// * `contact_dir` - Directory where contact files are stored
/// * `uuid` - UUID of the contact to convert
/// * `target_format` - Format to convert to (JSContact or VCard)
///
/// # Returns
/// * `Result<String, String>` - Path to the new file, or error message
///
/// # Behavior
/// * Reads the existing contact and detects its format
/// * If already in target format, returns success without changes
/// * Converts to target format, writes new file, and deletes old file
pub fn convert_contact_format<P: AsRef<Path>>(
    contact_dir: P,
    uuid: &str,
    target_format: ContactFormat,
) -> Result<String, String> {
    let dir = contact_dir.as_ref();
    let (contact, current_format) = read_contact_with_format(&contact_dir, uuid)?;

    // If already in target format, return success
    if current_format == target_format {
        return Ok(format!("Contact already in {} format", match target_format {
            ContactFormat::JSContact => "JSContact",
            ContactFormat::VCard => "vCard",
        }));
    }

    // Convert contact struct to NewContactData
    let data = NewContactData {
        given_name: contact.given_name,
        middle_name: contact.middle_name,
        family_name: contact.family_name,
        birthday: contact.birthday,
        anniversary: contact.anniversary,
        emails: contact.emails,
        phones: contact.phones,
        addresses: contact.addresses,
        photo: contact.photo,
        organization: contact.organization,
        title: contact.title,
        url: contact.url,
        note: contact.note,
    };

    // Find and delete the old file
    let old_file_path = PathBuf::from(&contact.file_path);

    // Create new file in target format with same UID
    let new_file_path = match target_format {
        ContactFormat::JSContact => {
            let jscontact_json = build_jscontact_json(&contact.uid, &data);
            let json_content = serde_json::to_string_pretty(&jscontact_json)
                .map_err(|e| format!("Failed to serialize JSContact: {}", e))?;

            let uuid_str = contact.uid.strip_prefix("urn:uuid:").unwrap_or(&contact.uid);
            let filename = build_contact_filename(
                data.family_name.as_deref(),
                data.given_name.as_deref(),
                uuid_str,
                "jscontact",
            );

            let new_path = dir.join(&filename);
            fs::write(&new_path, json_content)
                .map_err(|e| format!("Failed to write JSContact file: {}", e))?;

            new_path
        }
        ContactFormat::VCard => {
            let vcard_content = build_vcard(&contact.uid, &data)?;

            let uuid_str = contact.uid.strip_prefix("urn:uuid:").unwrap_or(&contact.uid);
            let filename = build_contact_filename(
                data.family_name.as_deref(),
                data.given_name.as_deref(),
                uuid_str,
                "vcf",
            );

            let new_path = dir.join(&filename);
            fs::write(&new_path, vcard_content)
                .map_err(|e| format!("Failed to write vCard file: {}", e))?;

            new_path
        }
    };

    // Delete old file only after successfully creating new file
    fs::remove_file(&old_file_path)
        .map_err(|e| {
            // If deletion fails, try to clean up the new file
            let _ = fs::remove_file(&new_file_path);
            format!("Failed to remove old file: {}", e)
        })?;

    Ok(new_file_path.to_string_lossy().to_string())
}

/// Helper function to convert PartialDate to ISO 8601 string
fn partial_date_to_iso(pd: &PartialDate) -> String {
    match (pd.year, pd.month, pd.day) {
        (Some(y), Some(m), Some(d)) => format!("{:04}{:02}{:02}", y, m, d),
        (Some(y), Some(m), None) => format!("{:04}{:02}", y, m),
        (Some(y), None, None) => format!("{:04}", y),
        (None, Some(m), Some(d)) => format!("--{:02}{:02}", m, d),
        _ => String::new(),
    }
}

/// Helper function to convert ISO 8601 string to PartialDate
fn iso_to_partial_date(iso: &str) -> Result<PartialDate, String> {
    let iso = iso.trim();

    // Handle different ISO 8601 date formats
    let (year, month, day) = if iso.starts_with("--") {
        // Format: --MMDD (no year)
        let rest = &iso[2..];
        if rest.len() == 4 {
            let m = rest[0..2].parse::<u32>().ok();
            let d = rest[2..4].parse::<u32>().ok();
            (None, m, d)
        } else {
            return Err(format!("Invalid partial date format: {}", iso));
        }
    } else if iso.len() == 8 {
        // Format: YYYYMMDD
        (
            iso[0..4].parse::<u32>().ok(),
            iso[4..6].parse::<u32>().ok(),
            iso[6..8].parse::<u32>().ok(),
        )
    } else if iso.len() == 6 {
        // Format: YYYYMM
        (
            iso[0..4].parse::<u32>().ok(),
            iso[4..6].parse::<u32>().ok(),
            None,
        )
    } else if iso.len() == 4 {
        // Format: YYYY
        (iso.parse::<u32>().ok(), None, None)
    } else if iso.contains('-') && !iso.starts_with("--") {
        // Format: YYYY-MM-DD or similar with hyphens
        let parts: Vec<&str> = iso.split('-').collect();
        match parts.len() {
            3 => (
                parts[0].parse::<u32>().ok(),
                parts[1].parse::<u32>().ok(),
                parts[2].parse::<u32>().ok(),
            ),
            2 => (
                parts[0].parse::<u32>().ok(),
                parts[1].parse::<u32>().ok(),
                None,
            ),
            _ => return Err(format!("Invalid date format: {}", iso)),
        }
    } else {
        return Err(format!("Unsupported date format: {}", iso));
    };

    Ok(PartialDate {
        type_: Some("PartialDate".to_string()),
        year,
        month,
        day,
    })
}

/// Helper function to build a vCard string from contact data
fn build_vcard(uid: &str, data: &NewContactData) -> Result<String, String> {
    let mut vcard_lines = vec!["BEGIN:VCARD".to_string(), "VERSION:4.0".to_string()];

    // Add UID (strip urn:uuid: prefix if present)
    let uid_value = uid.strip_prefix("urn:uuid:").unwrap_or(uid);
    vcard_lines.push(format!("UID:{}", uid_value));

    // Build N (structured name) and FN (formatted name)
    let n_components = vec![
        data.family_name.as_deref().unwrap_or(""),
        data.given_name.as_deref().unwrap_or(""),
        data.middle_name.as_deref().unwrap_or(""),
        "", // prefix
        "", // suffix
    ];
    vcard_lines.push(format!("N:{}", n_components.join(";")));

    // Build FN (formatted name)
    let fn_parts: Vec<&str> = vec![
        data.given_name.as_deref().unwrap_or(""),
        data.middle_name.as_deref().unwrap_or(""),
        data.family_name.as_deref().unwrap_or(""),
    ].into_iter().filter(|s| !s.is_empty()).collect();

    let fn_value = if fn_parts.is_empty() {
        "Unnamed Contact".to_string()
    } else {
        fn_parts.join(" ")
    };
    vcard_lines.push(format!("FN:{}", fn_value));

    // Add BDAY if present
    if let Some(ref birthday) = data.birthday {
        if birthday.year.is_some() || birthday.month.is_some() || birthday.day.is_some() {
            let iso_date = partial_date_to_iso(birthday);
            if !iso_date.is_empty() {
                vcard_lines.push(format!("BDAY:{}", iso_date));
            }
        }
    }

    // Add ANNIVERSARY if present
    if let Some(ref anniversary) = data.anniversary {
        if anniversary.year.is_some() || anniversary.month.is_some() || anniversary.day.is_some() {
            let iso_date = partial_date_to_iso(anniversary);
            if !iso_date.is_empty() {
                vcard_lines.push(format!("ANNIVERSARY:{}", iso_date));
            }
        }
    }

    // Add emails
    if let Some(ref emails) = data.emails {
        for email in emails {
            if !email.email.is_empty() {
                if let Some(ref label) = email.label {
                    if !label.is_empty() {
                        vcard_lines.push(format!("EMAIL;TYPE={}:{}", label, email.email));
                    } else {
                        vcard_lines.push(format!("EMAIL:{}", email.email));
                    }
                } else {
                    vcard_lines.push(format!("EMAIL:{}", email.email));
                }
            }
        }
    }

    // Add phones
    if let Some(ref phones) = data.phones {
        for phone in phones {
            if !phone.number.is_empty() {
                let type_str = if let Some(ref label) = phone.label {
                    if !label.is_empty() {
                        format!("TYPE={}", label)
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };

                if type_str.is_empty() {
                    vcard_lines.push(format!("TEL:{}", phone.number));
                } else {
                    vcard_lines.push(format!("TEL;{}:{}", type_str, phone.number));
                }
            }
        }
    }

    // Add addresses
    if let Some(ref addresses) = data.addresses {
        for address in addresses {
            // ADR format: ;;street;locality;region;postcode;country
            let adr_components = vec![
                "", // PO Box
                "", // Extended address
                &address.street,
                address.locality.as_deref().unwrap_or(""),
                address.region.as_deref().unwrap_or(""),
                address.postcode.as_deref().unwrap_or(""),
                address.country.as_deref().unwrap_or(""),
            ];

            let adr_value = adr_components.join(";");

            if let Some(ref label) = address.label {
                if !label.is_empty() {
                    vcard_lines.push(format!("ADR;TYPE={}:{}", label, adr_value));
                } else {
                    vcard_lines.push(format!("ADR:{}", adr_value));
                }
            } else {
                vcard_lines.push(format!("ADR:{}", adr_value));
            }
        }
    }

    // Add PHOTO if present
    if let Some(ref photo) = data.photo {
        if !photo.is_empty() {
            vcard_lines.push(format!("PHOTO:{}", photo));
        }
    }

    // Add ORG if present
    if let Some(ref org) = data.organization {
        if !org.is_empty() {
            vcard_lines.push(format!("ORG:{}", org));
        }
    }

    // Add TITLE if present
    if let Some(ref title) = data.title {
        if !title.is_empty() {
            vcard_lines.push(format!("TITLE:{}", title));
        }
    }

    // Add URL if present
    if let Some(ref url) = data.url {
        if !url.is_empty() {
            vcard_lines.push(format!("URL:{}", url));
        }
    }

    // Add NOTE if present
    if let Some(ref note) = data.note {
        if !note.is_empty() {
            // Escape newlines in notes
            let escaped_note = note.replace('\n', "\\n");
            vcard_lines.push(format!("NOTE:{}", escaped_note));
        }
    }

    vcard_lines.push("END:VCARD".to_string());

    Ok(vcard_lines.join("\r\n"))
}

/// Helper function to parse a vCard file into a Contact struct
fn parse_vcard_file(file_path: &Path) -> Result<Contact, String> {
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read vCard file: {}", e))?;

    // Simple vCard parser (line-based)
    let mut uid = None;
    let mut given_name = None;
    let mut middle_name = None;
    let mut family_name = None;
    let mut birthday = None;
    let mut anniversary = None;
    let mut emails = Vec::new();
    let mut phones = Vec::new();
    let mut addresses = Vec::new();
    let mut photo = None;
    let mut organization = None;
    let mut title = None;
    let mut url = None;
    let mut note = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line == "BEGIN:VCARD" || line == "END:VCARD" || line.starts_with("VERSION:") {
            continue;
        }

        // Split on first colon
        if let Some(colon_pos) = line.find(':') {
            let (prop_part, value_part) = line.split_at(colon_pos);
            let value = &value_part[1..]; // Skip the colon

            // Parse property name and parameters
            let (prop_name, params) = if let Some(semi_pos) = prop_part.find(';') {
                let (name, param_str) = prop_part.split_at(semi_pos);
                (name, Some(&param_str[1..])) // Skip the semicolon
            } else {
                (prop_part, None)
            };

            match prop_name {
                "UID" => {
                    uid = Some(format!("urn:uuid:{}", value));
                }
                "N" => {
                    // N format: Family;Given;Middle;Prefix;Suffix
                    let parts: Vec<&str> = value.split(';').collect();
                    if !parts.is_empty() && !parts[0].is_empty() {
                        family_name = Some(parts[0].to_string());
                    }
                    if parts.len() > 1 && !parts[1].is_empty() {
                        given_name = Some(parts[1].to_string());
                    }
                    if parts.len() > 2 && !parts[2].is_empty() {
                        middle_name = Some(parts[2].to_string());
                    }
                }
                "BDAY" => {
                    if let Ok(pd) = iso_to_partial_date(value) {
                        birthday = Some(pd);
                    }
                }
                "ANNIVERSARY" => {
                    if let Ok(pd) = iso_to_partial_date(value) {
                        anniversary = Some(pd);
                    }
                }
                "EMAIL" => {
                    let label = params.and_then(|p| {
                        if p.starts_with("TYPE=") {
                            Some(p[5..].to_string())
                        } else {
                            None
                        }
                    });
                    emails.push(EmailAddress {
                        email: value.to_string(),
                        label,
                    });
                }
                "TEL" => {
                    let label = params.and_then(|p| {
                        if p.starts_with("TYPE=") {
                            Some(p[5..].to_string())
                        } else {
                            None
                        }
                    });
                    phones.push(PhoneNumber {
                        number: value.to_string(),
                        label,
                        features: None,
                    });
                }
                "ADR" => {
                    // ADR format: POBox;ExtAddr;Street;Locality;Region;Postcode;Country
                    let parts: Vec<&str> = value.split(';').collect();
                    if parts.len() >= 3 {
                        let label = params.and_then(|p| {
                            if p.starts_with("TYPE=") {
                                Some(p[5..].to_string())
                            } else {
                                None
                            }
                        });

                        addresses.push(Address {
                            street: parts[2].to_string(),
                            locality: if parts.len() > 3 && !parts[3].is_empty() {
                                Some(parts[3].to_string())
                            } else {
                                None
                            },
                            region: if parts.len() > 4 && !parts[4].is_empty() {
                                Some(parts[4].to_string())
                            } else {
                                None
                            },
                            postcode: if parts.len() > 5 && !parts[5].is_empty() {
                                Some(parts[5].to_string())
                            } else {
                                None
                            },
                            country: if parts.len() > 6 && !parts[6].is_empty() {
                                Some(parts[6].to_string())
                            } else {
                                None
                            },
                            label,
                        });
                    }
                }
                "PHOTO" => {
                    photo = Some(value.to_string());
                }
                "ORG" => {
                    organization = Some(value.to_string());
                }
                "TITLE" => {
                    title = Some(value.to_string());
                }
                "URL" => {
                    url = Some(value.to_string());
                }
                "NOTE" => {
                    // Unescape newlines
                    let unescaped_note = value.replace("\\n", "\n");
                    note = Some(unescaped_note);
                }
                _ => {} // Ignore unknown properties
            }
        }
    }

    // Generate a UID if not present
    let uid = uid.unwrap_or_else(|| format!("urn:uuid:{}", Uuid::new_v4()));

    Ok(Contact {
        uid,
        given_name,
        middle_name,
        family_name,
        birthday,
        anniversary,
        emails: if emails.is_empty() { None } else { Some(emails) },
        phones: if phones.is_empty() { None } else { Some(phones) },
        addresses: if addresses.is_empty() { None } else { Some(addresses) },
        photo,
        organization,
        title,
        url,
        note,
        file_path: file_path.to_string_lossy().to_string(),
    })
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
                if let Some(date_value) = value.get("date") {
                    // Parse as PartialDate object (RFC 9553 compliant)
                    let partial_date = serde_json::from_value::<PartialDate>(date_value.clone()).ok();

                    match kind {
                        "birth" => birthday = partial_date,
                        "wedding" => anniversary = partial_date,
                        _ => {}
                    }
                }
            }
        }
    }

    // Extract emails
    let emails = json.get("emails")
        .and_then(|e| e.as_object())
        .map(|emails_obj| {
            let email_vec: Vec<EmailAddress> = emails_obj.iter()
                .filter_map(|(_key, value)| {
                    let email_str = value.get("email").and_then(|e| e.as_str())?;

                    let label = value.get("label")
                        .and_then(|l| l.as_str())
                        .map(|s| s.to_string());

                    Some(EmailAddress {
                        email: email_str.to_string(),
                        label,
                    })
                })
                .collect();

            if email_vec.is_empty() { None } else { Some(email_vec) }
        })
        .flatten();

    // Extract phones
    let phones = json.get("phones")
        .and_then(|p| p.as_object())
        .map(|phones_obj| {
            let phone_vec: Vec<PhoneNumber> = phones_obj.iter()
                .filter_map(|(_key, value)| {
                    let phone_str = value.get("phone").and_then(|p| p.as_str())?;

                    let label = value.get("label")
                        .and_then(|l| l.as_str())
                        .map(|s| s.to_string());

                    let features = value.get("features")
                        .and_then(|f| f.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect::<Vec<String>>()
                        });

                    Some(PhoneNumber {
                        number: phone_str.to_string(),
                        label,
                        features,
                    })
                })
                .collect();

            if phone_vec.is_empty() { None } else { Some(phone_vec) }
        })
        .flatten();

    // Extract addresses
    let addresses = json.get("addresses")
        .and_then(|a| a.as_object())
        .map(|addresses_obj| {
            let address_vec: Vec<Address> = addresses_obj.iter()
                .filter_map(|(_key, value)| {
                    let street = value.get("street").and_then(|s| s.as_str())?;

                    let locality = value.get("locality")
                        .and_then(|l| l.as_str())
                        .map(|s| s.to_string());

                    let region = value.get("region")
                        .and_then(|r| r.as_str())
                        .map(|s| s.to_string());

                    let postcode = value.get("postcode")
                        .and_then(|p| p.as_str())
                        .map(|s| s.to_string());

                    let country = value.get("country")
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string());

                    let label = value.get("label")
                        .and_then(|l| l.as_str())
                        .map(|s| s.to_string());

                    Some(Address {
                        street: street.to_string(),
                        locality,
                        region,
                        postcode,
                        country,
                        label,
                    })
                })
                .collect();

            if address_vec.is_empty() { None } else { Some(address_vec) }
        })
        .flatten();

    // Extract photo
    let photo = json.get("photos")
        .and_then(|p| p.as_object())
        .and_then(|photos_obj| {
            photos_obj.values().next()
                .and_then(|photo_obj| photo_obj.get("href"))
                .and_then(|h| h.as_str())
                .map(|s| s.to_string())
        });

    // Extract organization
    let organization = json.get("organizations")
        .and_then(|o| o.as_object())
        .and_then(|orgs_obj| {
            orgs_obj.values().next()
                .and_then(|org_obj| org_obj.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        });

    // Extract job title
    let title = json.get("jobTitles")
        .and_then(|j| j.as_object())
        .and_then(|titles_obj| {
            titles_obj.values().next()
                .and_then(|title_obj| title_obj.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        });

    // Extract URL
    let url = json.get("onlineServices")
        .and_then(|o| o.as_object())
        .and_then(|services_obj| {
            services_obj.values().next()
                .and_then(|service_obj| service_obj.get("uri"))
                .and_then(|u| u.as_str())
                .map(|s| s.to_string())
        });

    // Extract note
    let note = json.get("notes")
        .and_then(|n| n.as_object())
        .and_then(|notes_obj| {
            notes_obj.values().next()
                .and_then(|note_obj| note_obj.get("note"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string())
        });

    Ok(Contact {
        uid,
        given_name,
        middle_name,
        family_name,
        birthday,
        anniversary,
        emails,
        phones,
        addresses,
        photo,
        organization,
        title,
        url,
        note,
        file_path: file_path.to_string_lossy().to_string(),
    })
}
