import path from 'path';
import sqlite3 from 'sqlite3';

const dataDir = path.resolve('data');

// TODO check if dataDir exists, make it if it doesn't

const db = new sqlite3.Database(path.resolve(dataDir, 'development.db'));

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
		year TEXT
	)`);
});

export default db;
