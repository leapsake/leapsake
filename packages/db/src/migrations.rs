use include_dir::{include_dir, Dir};
use rusqlite::Connection;
use std::collections::BTreeMap;

// Embed the migrations directory at compile time
static MIGRATIONS_DIR: Dir = include_dir!("$CARGO_MANIFEST_DIR/migrations");

/// Dynamically loads and runs migrations from the embedded migrations directory
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Create migrations tracking table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS migrations (
            name TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )",
        [],
    )?;

    // Collect all migration files and sort by filename (timestamp prefix ensures correct order)
    let mut migrations = BTreeMap::new();

    for file in MIGRATIONS_DIR.files() {
        if let Some(filename) = file.path().file_name().and_then(|n| n.to_str()) {
            if filename.ends_with(".sql") {
                if let Some(contents) = file.contents_utf8() {
                    migrations.insert(filename.to_string(), contents);
                } else {
                    log::warn!("Skipping migration {}: not UTF-8", filename);
                }
            }
        }
    }

    // Apply migrations in order
    for (name, sql) in migrations {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM migrations WHERE name = ?)",
            [&name],
            |row| row.get(0),
        )?;

        if !already_applied {
            log::info!("Applying migration: {}", name);
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO migrations (name) VALUES (?)",
                [&name],
            )?;
        }
    }

    Ok(())
}
