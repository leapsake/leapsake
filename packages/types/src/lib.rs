pub mod db;
pub mod contacts;

// Re-export all types for convenience
pub use db::*;
pub use contacts::*;

#[cfg(test)]
mod tests {
    use super::*;
    use ts_rs::TS;

    #[test]
    fn export_bindings() {
        // Database types
        db::PartialDate::export().unwrap();
        db::EmailAddress::export().unwrap();
        db::PhoneNumber::export().unwrap();
        db::Address::export().unwrap();
        db::Person::export().unwrap();
        db::NewPerson::export().unwrap();
        db::PersonWithDetails::export().unwrap();

        // Contact format types
        contacts::PartialDate::export().unwrap();
        contacts::EmailAddress::export().unwrap();
        contacts::PhoneNumber::export().unwrap();
        contacts::Address::export().unwrap();
        contacts::NewContactData::export().unwrap();
        contacts::Contact::export().unwrap();
        contacts::JSContactData::export().unwrap();
        contacts::VCardData::export().unwrap();
        contacts::ContactFormat::export().unwrap();
    }
}
