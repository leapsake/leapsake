import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('development.db');

db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS People(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		dateable_id TEXT,
		family_name TEXT,
		given_name TEXT
	)`);


	db.run(`CREATE TABLE IF NOT EXISTS Dateables(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS SpecialDates(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		dateable_id TEXT,
		day TEXT,
		month TEXT,
		year TEXT
	)`);
});

export default db;
