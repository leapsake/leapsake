import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('development.db');

db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS People(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		given_name TEXT,
		family_name TEXT
	)`);
});

export default db;
