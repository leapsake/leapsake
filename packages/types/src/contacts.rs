use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Represents a partial date according to JSContact RFC 9553 section 2.8.1
///
/// A PartialDate represents calendar dates in the Gregorian calendar system.
/// All fields are optional, allowing representation of:
/// - Complete dates (year, month, day)
/// - Year only
/// - Month in year (year + month)
/// - Day in month (month + day)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/", rename = "ContactPartialDate")]
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

/// Email address for JSContact/vCard (no database fields)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/", rename = "ContactEmailAddress")]
pub struct EmailAddress {
    pub email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Phone number for JSContact/vCard (no database fields)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/", rename = "ContactPhoneNumber")]
pub struct PhoneNumber {
    pub number: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<Vec<String>>,
}

/// Address for JSContact/vCard (no database fields)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/", rename = "ContactAddress")]
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

/// Raw JSContact file data
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct JSContactData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

/// Raw vCard file data
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings/")]
pub struct VCardData {
    pub content: String,
    pub file_name: String,
    pub path: String,
}

/// Contact format enum
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
pub enum ContactFormat {
    JSContact,
    VCard,
}

/// Data for creating a new contact
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "bindings/")]
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

/// Parsed contact ready for display
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "bindings/")]
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
