use crate::types::*;
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Get current timestamp in milliseconds since Unix epoch
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Create a new person with associated emails, phones, and addresses
pub fn create_person(
    conn: &Connection,
    new_person: NewPerson,
    emails: Vec<(String, Option<String>)>, // (email, label)
    phones: Vec<(String, Option<String>, Option<Vec<String>>)>, // (number, label, features)
    addresses: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>, // (street, locality, region, postcode, country, label)
) -> Result<String> {
    let person_id = Uuid::new_v4().to_string();
    let now = now_millis();

    // Insert person
    conn.execute(
        "INSERT INTO people (id, given_name, middle_name, family_name, birthday, anniversary, photo, organization, title, url, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            person_id,
            new_person.given_name,
            new_person.middle_name,
            new_person.family_name,
            new_person.birthday.and_then(|d| d.to_iso_string()),
            new_person.anniversary.and_then(|d| d.to_iso_string()),
            new_person.photo,
            new_person.organization,
            new_person.title,
            new_person.url,
            new_person.note,
            now,
            now,
        ],
    )?;

    // Insert emails
    for (position, (email, label)) in emails.iter().enumerate() {
        let email_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO email_addresses (id, person_id, email, label, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![email_id, person_id, email, label, position as i32],
        )?;
    }

    // Insert phones
    for (position, (number, label, features)) in phones.iter().enumerate() {
        let phone_id = Uuid::new_v4().to_string();
        let features_json = features.as_ref().map(|f| serde_json::to_string(f).unwrap());
        conn.execute(
            "INSERT INTO phone_numbers (id, person_id, number, label, features_json, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![phone_id, person_id, number, label, features_json, position as i32],
        )?;
    }

    // Insert addresses
    for (position, (street, locality, region, postcode, country, label)) in addresses.iter().enumerate() {
        let address_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO addresses (id, person_id, street, locality, region, postcode, country, label, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![address_id, person_id, street, locality, region, postcode, country, label, position as i32],
        )?;
    }

    Ok(person_id)
}

/// Read a person by ID with all related data
pub fn read_person(conn: &Connection, person_id: &str) -> Result<Option<PersonWithDetails>> {
    // Get person
    let person: Option<Person> = conn
        .query_row(
            "SELECT id, given_name, middle_name, family_name, birthday, anniversary, photo, organization, title, url, note, created_at, updated_at
             FROM people WHERE id = ?1",
            params![person_id],
            |row| {
                Ok(Person {
                    id: row.get(0)?,
                    given_name: row.get(1)?,
                    middle_name: row.get(2)?,
                    family_name: row.get(3)?,
                    birthday: row.get::<_, Option<String>>(4)?.and_then(|s| PartialDate::from_iso_string(&s)),
                    anniversary: row.get::<_, Option<String>>(5)?.and_then(|s| PartialDate::from_iso_string(&s)),
                    photo: row.get(6)?,
                    organization: row.get(7)?,
                    title: row.get(8)?,
                    url: row.get(9)?,
                    note: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .optional()?;

    let person = match person {
        Some(p) => p,
        None => return Ok(None),
    };

    // Get emails
    let mut stmt = conn.prepare("SELECT id, person_id, email, label, position FROM email_addresses WHERE person_id = ?1 ORDER BY position")?;
    let emails: Vec<EmailAddress> = stmt
        .query_map(params![person_id], |row| {
            Ok(EmailAddress {
                id: row.get(0)?,
                person_id: row.get(1)?,
                email: row.get(2)?,
                label: row.get(3)?,
                position: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    // Get phones
    let mut stmt = conn.prepare("SELECT id, person_id, number, label, features_json, position FROM phone_numbers WHERE person_id = ?1 ORDER BY position")?;
    let phones: Vec<PhoneNumber> = stmt
        .query_map(params![person_id], |row| {
            let features_json: Option<String> = row.get(4)?;
            let features = features_json.and_then(|s| serde_json::from_str(&s).ok());
            Ok(PhoneNumber {
                id: row.get(0)?,
                person_id: row.get(1)?,
                number: row.get(2)?,
                label: row.get(3)?,
                features,
                position: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    // Get addresses
    let mut stmt = conn.prepare("SELECT id, person_id, street, locality, region, postcode, country, label, position FROM addresses WHERE person_id = ?1 ORDER BY position")?;
    let addresses: Vec<Address> = stmt
        .query_map(params![person_id], |row| {
            Ok(Address {
                id: row.get(0)?,
                person_id: row.get(1)?,
                street: row.get(2)?,
                locality: row.get(3)?,
                region: row.get(4)?,
                postcode: row.get(5)?,
                country: row.get(6)?,
                label: row.get(7)?,
                position: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(Some(PersonWithDetails {
        person,
        emails,
        phones,
        addresses,
    }))
}

/// Update a person's core fields (not emails/phones/addresses - use separate functions for those)
pub fn update_person(
    conn: &Connection,
    person_id: &str,
    new_person: NewPerson,
) -> Result<()> {
    let now = now_millis();

    conn.execute(
        "UPDATE people SET given_name = ?1, middle_name = ?2, family_name = ?3, birthday = ?4, anniversary = ?5, photo = ?6, organization = ?7, title = ?8, url = ?9, note = ?10, updated_at = ?11
         WHERE id = ?12",
        params![
            new_person.given_name,
            new_person.middle_name,
            new_person.family_name,
            new_person.birthday.and_then(|d| d.to_iso_string()),
            new_person.anniversary.and_then(|d| d.to_iso_string()),
            new_person.photo,
            new_person.organization,
            new_person.title,
            new_person.url,
            new_person.note,
            now,
            person_id,
        ],
    )?;

    Ok(())
}

/// Update a person with all associated data (emails, phones, addresses)
/// This replaces all related data - existing items are deleted and new ones are inserted
pub fn update_person_with_details(
    conn: &Connection,
    person_id: &str,
    new_person: NewPerson,
    emails: Vec<(String, Option<String>)>, // (email, label)
    phones: Vec<(String, Option<String>, Option<Vec<String>>)>, // (number, label, features)
    addresses: Vec<(String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>)>, // (street, locality, region, postcode, country, label)
) -> Result<()> {
    let now = now_millis();

    // Update person core fields
    conn.execute(
        "UPDATE people SET given_name = ?1, middle_name = ?2, family_name = ?3, birthday = ?4, anniversary = ?5, photo = ?6, organization = ?7, title = ?8, url = ?9, note = ?10, updated_at = ?11
         WHERE id = ?12",
        params![
            new_person.given_name,
            new_person.middle_name,
            new_person.family_name,
            new_person.birthday.and_then(|d| d.to_iso_string()),
            new_person.anniversary.and_then(|d| d.to_iso_string()),
            new_person.photo,
            new_person.organization,
            new_person.title,
            new_person.url,
            new_person.note,
            now,
            person_id,
        ],
    )?;

    // Delete all existing emails, phones, and addresses
    conn.execute("DELETE FROM email_addresses WHERE person_id = ?1", params![person_id])?;
    conn.execute("DELETE FROM phone_numbers WHERE person_id = ?1", params![person_id])?;
    conn.execute("DELETE FROM addresses WHERE person_id = ?1", params![person_id])?;

    // Insert new emails
    for (position, (email, label)) in emails.iter().enumerate() {
        let email_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO email_addresses (id, person_id, email, label, position) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![email_id, person_id, email, label, position as i32],
        )?;
    }

    // Insert new phones
    for (position, (number, label, features)) in phones.iter().enumerate() {
        let phone_id = Uuid::new_v4().to_string();
        let features_json = features.as_ref().map(|f| serde_json::to_string(f).unwrap());
        conn.execute(
            "INSERT INTO phone_numbers (id, person_id, number, label, features_json, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![phone_id, person_id, number, label, features_json, position as i32],
        )?;
    }

    // Insert new addresses
    for (position, (street, locality, region, postcode, country, label)) in addresses.iter().enumerate() {
        let address_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO addresses (id, person_id, street, locality, region, postcode, country, label, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![address_id, person_id, street, locality, region, postcode, country, label, position as i32],
        )?;
    }

    Ok(())
}

/// Delete a person (cascades to emails, phones, addresses)
pub fn delete_person(conn: &Connection, person_id: &str) -> Result<()> {
    conn.execute("DELETE FROM people WHERE id = ?1", params![person_id])?;
    Ok(())
}

/// List all people (without related data for performance)
pub fn list_people(conn: &Connection) -> Result<Vec<Person>> {
    let mut stmt = conn.prepare(
        "SELECT id, given_name, middle_name, family_name, birthday, anniversary, photo, organization, title, url, note, created_at, updated_at
         FROM people ORDER BY family_name, given_name",
    )?;

    let people = stmt
        .query_map([], |row| {
            Ok(Person {
                id: row.get(0)?,
                given_name: row.get(1)?,
                middle_name: row.get(2)?,
                family_name: row.get(3)?,
                birthday: row.get::<_, Option<String>>(4)?.and_then(|s| PartialDate::from_iso_string(&s)),
                anniversary: row.get::<_, Option<String>>(5)?.and_then(|s| PartialDate::from_iso_string(&s)),
                photo: row.get(6)?,
                organization: row.get(7)?,
                title: row.get(8)?,
                url: row.get(9)?,
                note: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(people)
}

/// Search people using FTS5 full-text search
pub fn search_people(conn: &Connection, query: &str) -> Result<Vec<Person>> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.given_name, p.middle_name, p.family_name, p.birthday, p.anniversary, p.photo, p.organization, p.title, p.url, p.note, p.created_at, p.updated_at
         FROM people p
         INNER JOIN people_fts ON p.id = people_fts.id
         WHERE people_fts MATCH ?1
         ORDER BY rank",
    )?;

    let people = stmt
        .query_map(params![query], |row| {
            Ok(Person {
                id: row.get(0)?,
                given_name: row.get(1)?,
                middle_name: row.get(2)?,
                family_name: row.get(3)?,
                birthday: row.get::<_, Option<String>>(4)?.and_then(|s| PartialDate::from_iso_string(&s)),
                anniversary: row.get::<_, Option<String>>(5)?.and_then(|s| PartialDate::from_iso_string(&s)),
                photo: row.get(6)?,
                organization: row.get(7)?,
                title: row.get(8)?,
                url: row.get(9)?,
                note: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(people)
}

/// Add an email address to a person
pub fn add_email(
    conn: &Connection,
    person_id: &str,
    email: &str,
    label: Option<&str>,
) -> Result<String> {
    // Get next position
    let position: i32 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM email_addresses WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;

    let email_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO email_addresses (id, person_id, email, label, position) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![email_id, person_id, email, label, position],
    )?;

    // Update person's updated_at
    conn.execute(
        "UPDATE people SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), person_id],
    )?;

    Ok(email_id)
}

/// Delete an email address
pub fn delete_email(conn: &Connection, email_id: &str) -> Result<()> {
    // Get person_id before deleting
    let person_id: Option<String> = conn.query_row(
        "SELECT person_id FROM email_addresses WHERE id = ?1",
        params![email_id],
        |row| row.get(0),
    ).optional()?;

    conn.execute("DELETE FROM email_addresses WHERE id = ?1", params![email_id])?;

    // Update person's updated_at
    if let Some(pid) = person_id {
        conn.execute(
            "UPDATE people SET updated_at = ?1 WHERE id = ?2",
            params![now_millis(), pid],
        )?;
    }

    Ok(())
}

/// Add a phone number to a person
pub fn add_phone(
    conn: &Connection,
    person_id: &str,
    number: &str,
    label: Option<&str>,
    features: Option<Vec<String>>,
) -> Result<String> {
    let position: i32 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM phone_numbers WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;

    let phone_id = Uuid::new_v4().to_string();
    let features_json = features.map(|f| serde_json::to_string(&f).unwrap());

    conn.execute(
        "INSERT INTO phone_numbers (id, person_id, number, label, features_json, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![phone_id, person_id, number, label, features_json, position],
    )?;

    conn.execute(
        "UPDATE people SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), person_id],
    )?;

    Ok(phone_id)
}

/// Delete a phone number
pub fn delete_phone(conn: &Connection, phone_id: &str) -> Result<()> {
    let person_id: Option<String> = conn.query_row(
        "SELECT person_id FROM phone_numbers WHERE id = ?1",
        params![phone_id],
        |row| row.get(0),
    ).optional()?;

    conn.execute("DELETE FROM phone_numbers WHERE id = ?1", params![phone_id])?;

    if let Some(pid) = person_id {
        conn.execute(
            "UPDATE people SET updated_at = ?1 WHERE id = ?2",
            params![now_millis(), pid],
        )?;
    }

    Ok(())
}

/// Add an address to a person
pub fn add_address(
    conn: &Connection,
    person_id: &str,
    street: &str,
    locality: Option<&str>,
    region: Option<&str>,
    postcode: Option<&str>,
    country: Option<&str>,
    label: Option<&str>,
) -> Result<String> {
    let position: i32 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM addresses WHERE person_id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;

    let address_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO addresses (id, person_id, street, locality, region, postcode, country, label, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![address_id, person_id, street, locality, region, postcode, country, label, position],
    )?;

    conn.execute(
        "UPDATE people SET updated_at = ?1 WHERE id = ?2",
        params![now_millis(), person_id],
    )?;

    Ok(address_id)
}

/// Delete an address
pub fn delete_address(conn: &Connection, address_id: &str) -> Result<()> {
    let person_id: Option<String> = conn.query_row(
        "SELECT person_id FROM addresses WHERE id = ?1",
        params![address_id],
        |row| row.get(0),
    ).optional()?;

    conn.execute("DELETE FROM addresses WHERE id = ?1", params![address_id])?;

    if let Some(pid) = person_id {
        conn.execute(
            "UPDATE people SET updated_at = ?1 WHERE id = ?2",
            params![now_millis(), pid],
        )?;
    }

    Ok(())
}
