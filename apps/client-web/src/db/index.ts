import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('data/development.db');

db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS People(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		family_name TEXT,
		given_name TEXT,
		middle_name TEXT
	)`);


	db.run(`CREATE TABLE IF NOT EXISTS Milestones(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		day TEXT,
		label TEXT,
		month TEXT,
		person_id TEXT,
		type TEXT,
		year TEXT
	)`);
});

export default db;
