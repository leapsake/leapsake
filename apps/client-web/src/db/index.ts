import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('development.db');

db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS people(
		id TEXT PRIMARY KEY,
		given_name TEXT,
		family_name TEXT
	)`);
});

export default db;
