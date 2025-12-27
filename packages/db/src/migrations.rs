use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Create migrations tracking table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS migrations (
            name TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )",
        [],
    )?;

    for (name, sql) in MIGRATIONS {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM migrations WHERE name = ?)",
            [name],
            |row| row.get(0),
        )?;

        if !already_applied {
            log::info!("Applying migration: {}", name);
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO migrations (name) VALUES (?)",
                [name],
            )?;
        }
    }

    Ok(())
}
