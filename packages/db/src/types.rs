use serde::{Deserialize, Serialize};

/// Represents a partial date according to JSContact RFC 9553 section 2.8.1
///
/// A PartialDate represents calendar dates in the Gregorian calendar system.
/// All fields are optional, allowing representation of:
/// - Complete dates (year, month, day)
/// - Year only
/// - Month in year (year + month)
/// - Day in month (month + day)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PartialDate {
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

impl PartialDate {
    /// Convert PartialDate to ISO 8601 string for database storage
    pub fn to_iso_string(&self) -> Option<String> {
        match (self.year, self.month, self.day) {
            (Some(y), Some(m), Some(d)) => Some(format!("{:04}-{:02}-{:02}", y, m, d)),
            (Some(y), Some(m), None) => Some(format!("{:04}-{:02}", y, m)),
            (Some(y), None, None) => Some(format!("{:04}", y)),
            (None, Some(m), Some(d)) => Some(format!("--{:02}-{:02}", m, d)),
            _ => None,
        }
    }

    /// Parse ISO 8601 string from database into PartialDate
    pub fn from_iso_string(s: &str) -> Option<Self> {
        let s = s.trim();

        if s.starts_with("--") {
            // Format: --MM-DD (no year)
            let parts: Vec<&str> = s[2..].split('-').collect();
            if parts.len() == 2 {
                return Some(PartialDate {
                    year: None,
                    month: parts[0].parse().ok(),
                    day: parts[1].parse().ok(),
                });
            }
        } else {
            let parts: Vec<&str> = s.split('-').collect();
            match parts.len() {
                3 => {
                    return Some(PartialDate {
                        year: parts[0].parse().ok(),
                        month: parts[1].parse().ok(),
                        day: parts[2].parse().ok(),
                    });
                }
                2 => {
                    return Some(PartialDate {
                        year: parts[0].parse().ok(),
                        month: parts[1].parse().ok(),
                        day: None,
                    });
                }
                1 => {
                    return Some(PartialDate {
                        year: parts[0].parse().ok(),
                        month: None,
                        day: None,
                    });
                }
                _ => {}
            }
        }

        None
    }
}

/// Email address data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAddress {
    pub id: String,
    pub person_id: String,
    pub email: String,
    pub label: Option<String>,
    pub position: i32,
}

/// Phone number data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneNumber {
    pub id: String,
    pub person_id: String,
    pub number: String,
    pub label: Option<String>,
    pub features: Option<Vec<String>>,
    pub position: i32,
}

/// Address data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Address {
    pub id: String,
    pub person_id: String,
    pub street: String,
    pub locality: Option<String>,
    pub region: Option<String>,
    pub postcode: Option<String>,
    pub country: Option<String>,
    pub label: Option<String>,
    pub position: i32,
}

/// Person record from database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<PartialDate>,
    pub anniversary: Option<PartialDate>,
    pub photo: Option<String>,
    pub organization: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Data for creating a new person
#[derive(Debug, Clone, Deserialize)]
pub struct NewPerson {
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub birthday: Option<PartialDate>,
    pub anniversary: Option<PartialDate>,
    pub photo: Option<String>,
    pub organization: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub note: Option<String>,
}

/// Complete person with all related data (emails, phones, addresses)
#[derive(Debug, Clone, Serialize)]
pub struct PersonWithDetails {
    pub person: Person,
    pub emails: Vec<EmailAddress>,
    pub phones: Vec<PhoneNumber>,
    pub addresses: Vec<Address>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partial_date_iso_roundtrip() {
        let pd = PartialDate {
            year: Some(1990),
            month: Some(5),
            day: Some(15),
        };
        let iso = pd.to_iso_string().unwrap();
        assert_eq!(iso, "1990-05-15");
        let parsed = PartialDate::from_iso_string(&iso).unwrap();
        assert_eq!(parsed, pd);
    }

    #[test]
    fn test_partial_date_year_only() {
        let pd = PartialDate {
            year: Some(1990),
            month: None,
            day: None,
        };
        let iso = pd.to_iso_string().unwrap();
        assert_eq!(iso, "1990");
        let parsed = PartialDate::from_iso_string(&iso).unwrap();
        assert_eq!(parsed, pd);
    }

    #[test]
    fn test_partial_date_no_year() {
        let pd = PartialDate {
            year: None,
            month: Some(5),
            day: Some(15),
        };
        let iso = pd.to_iso_string().unwrap();
        assert_eq!(iso, "--05-15");
        let parsed = PartialDate::from_iso_string(&iso).unwrap();
        assert_eq!(parsed, pd);
    }
}
