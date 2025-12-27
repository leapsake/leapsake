pub mod migrations;
pub mod queries;
pub mod types;

pub use migrations::run_migrations;
pub use queries::*;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_migrations_run_successfully() {
        let conn = setup_test_db();

        // Verify migrations table exists
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "Should have applied one migration");

        // Verify people table exists
        conn.execute("SELECT * FROM people LIMIT 1", []).unwrap();
    }

    #[test]
    fn test_migrations_are_idempotent() {
        let conn = setup_test_db();

        // Run migrations again
        run_migrations(&conn).unwrap();

        // Should still have only one migration applied
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_create_and_read_person() {
        let conn = setup_test_db();

        let new_person = NewPerson {
            given_name: Some("John".to_string()),
            middle_name: Some("Q".to_string()),
            family_name: Some("Doe".to_string()),
            birthday: Some(PartialDate {
                year: Some(1990),
                month: Some(5),
                day: Some(15),
            }),
            anniversary: None,
            photo: None,
            organization: Some("Acme Corp".to_string()),
            title: Some("Engineer".to_string()),
            url: None,
            note: None,
        };

        let emails = vec![
            ("john@example.com".to_string(), Some("work".to_string())),
            ("jdoe@personal.com".to_string(), Some("personal".to_string())),
        ];

        let phones = vec![
            ("555-1234".to_string(), Some("mobile".to_string()), None),
        ];

        let addresses = vec![
            ("123 Main St".to_string(), Some("Springfield".to_string()), Some("IL".to_string()), Some("62701".to_string()), Some("USA".to_string()), Some("home".to_string())),
        ];

        let person_id = create_person(&conn, new_person, emails, phones, addresses).unwrap();

        // Read the person back
        let person_with_details = read_person(&conn, &person_id).unwrap().unwrap();

        assert_eq!(person_with_details.person.given_name, Some("John".to_string()));
        assert_eq!(person_with_details.person.family_name, Some("Doe".to_string()));
        assert_eq!(person_with_details.person.organization, Some("Acme Corp".to_string()));
        assert_eq!(person_with_details.emails.len(), 2);
        assert_eq!(person_with_details.phones.len(), 1);
        assert_eq!(person_with_details.addresses.len(), 1);
    }

    #[test]
    fn test_update_person() {
        let conn = setup_test_db();

        let new_person = NewPerson {
            given_name: Some("John".to_string()),
            middle_name: None,
            family_name: Some("Doe".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: None,
            title: None,
            url: None,
            note: None,
        };

        let person_id = create_person(&conn, new_person, vec![], vec![], vec![]).unwrap();

        // Update the person
        let updated_person = NewPerson {
            given_name: Some("Jane".to_string()),
            middle_name: Some("Q".to_string()),
            family_name: Some("Smith".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: Some("New Corp".to_string()),
            title: Some("Manager".to_string()),
            url: None,
            note: None,
        };

        update_person(&conn, &person_id, updated_person).unwrap();

        // Read back
        let person_with_details = read_person(&conn, &person_id).unwrap().unwrap();
        assert_eq!(person_with_details.person.given_name, Some("Jane".to_string()));
        assert_eq!(person_with_details.person.family_name, Some("Smith".to_string()));
        assert_eq!(person_with_details.person.organization, Some("New Corp".to_string()));
    }

    #[test]
    fn test_delete_person() {
        let conn = setup_test_db();

        let new_person = NewPerson {
            given_name: Some("John".to_string()),
            middle_name: None,
            family_name: Some("Doe".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: None,
            title: None,
            url: None,
            note: None,
        };

        let person_id = create_person(&conn, new_person, vec![], vec![], vec![]).unwrap();

        // Delete
        delete_person(&conn, &person_id).unwrap();

        // Should not be found
        let result = read_person(&conn, &person_id).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_list_people() {
        let conn = setup_test_db();

        // Create multiple people
        for i in 1..=3 {
            let new_person = NewPerson {
                given_name: Some(format!("Person{}", i)),
                middle_name: None,
                family_name: Some("Test".to_string()),
                birthday: None,
                anniversary: None,
                photo: None,
                organization: None,
                title: None,
                url: None,
                note: None,
            };
            create_person(&conn, new_person, vec![], vec![], vec![]).unwrap();
        }

        let people = list_people(&conn).unwrap();
        assert_eq!(people.len(), 3);
    }

    #[test]
    fn test_search_people() {
        let conn = setup_test_db();

        let new_person1 = NewPerson {
            given_name: Some("John".to_string()),
            middle_name: None,
            family_name: Some("Doe".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: Some("Acme Corp".to_string()),
            title: None,
            url: None,
            note: None,
        };
        create_person(&conn, new_person1, vec![], vec![], vec![]).unwrap();

        let new_person2 = NewPerson {
            given_name: Some("Jane".to_string()),
            middle_name: None,
            family_name: Some("Smith".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: Some("Beta Inc".to_string()),
            title: None,
            url: None,
            note: None,
        };
        create_person(&conn, new_person2, vec![], vec![], vec![]).unwrap();

        // Search for "Acme"
        let results = search_people(&conn, "Acme").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].given_name, Some("John".to_string()));

        // Search for "Jane"
        let results = search_people(&conn, "Jane").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].family_name, Some("Smith".to_string()));
    }

    #[test]
    fn test_add_and_delete_email() {
        let conn = setup_test_db();

        let new_person = NewPerson {
            given_name: Some("John".to_string()),
            middle_name: None,
            family_name: Some("Doe".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: None,
            title: None,
            url: None,
            note: None,
        };

        let person_id = create_person(&conn, new_person, vec![], vec![], vec![]).unwrap();

        // Add email
        let email_id = add_email(&conn, &person_id, "john@example.com", Some("work")).unwrap();

        // Check it exists
        let person = read_person(&conn, &person_id).unwrap().unwrap();
        assert_eq!(person.emails.len(), 1);

        // Delete email
        delete_email(&conn, &email_id).unwrap();

        // Check it's gone
        let person = read_person(&conn, &person_id).unwrap().unwrap();
        assert_eq!(person.emails.len(), 0);
    }

    #[test]
    fn test_partial_date_conversion() {
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
    fn test_fts_triggers() {
        let conn = setup_test_db();

        // Create a person
        let new_person = NewPerson {
            given_name: Some("Alice".to_string()),
            middle_name: None,
            family_name: Some("Johnson".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: Some("Tech Corp".to_string()),
            title: None,
            url: None,
            note: Some("Software engineer".to_string()),
        };

        let person_id = create_person(&conn, new_person, vec![], vec![], vec![]).unwrap();

        // Should be searchable immediately
        let results = search_people(&conn, "Alice").unwrap();
        assert_eq!(results.len(), 1);

        let results = search_people(&conn, "Tech").unwrap();
        assert_eq!(results.len(), 1);

        // Update person
        let updated = NewPerson {
            given_name: Some("Alice".to_string()),
            middle_name: None,
            family_name: Some("Johnson".to_string()),
            birthday: None,
            anniversary: None,
            photo: None,
            organization: Some("New Company".to_string()),
            title: None,
            url: None,
            note: None,
        };

        update_person(&conn, &person_id, updated).unwrap();

        // Old organization should not be found
        let results = search_people(&conn, "Tech").unwrap();
        assert_eq!(results.len(), 0);

        // New organization should be found
        let results = search_people(&conn, "New").unwrap();
        assert_eq!(results.len(), 1);

        // Delete person
        delete_person(&conn, &person_id).unwrap();

        // Should not be searchable anymore
        let results = search_people(&conn, "Alice").unwrap();
        assert_eq!(results.len(), 0);
    }
}
