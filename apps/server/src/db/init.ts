import fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';

const dataDir = path.resolve('data');
const databasePath = path.resolve(dataDir, 'development.db');
const db = new sqlite3.Database(databasePath);

if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir);
}

db.serialize(() => {
	db.run(`CREATE TABLE IF NOT EXISTS People(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		family_name TEXT,
		given_name TEXT,
		maiden_name TEXT,
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

	db.run(`CREATE TABLE IF NOT EXISTS EmailAddresses(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		address TEXT,
		label TEXT,
		person_id TEXT
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS PhoneNumbers(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		label TEXT,
		number TEXT,
		person_id TEXT
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS Photos(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		alt TEXT,
		description TEXT,
		path TEXT
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS PhotoAlbums(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		description TEXT
	)`);

	db.run(`CREATE TABLE IF NOT EXISTS PhotoAlbumItems(
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		photo_id TEXT,
		photo_album_id TEXT
	)`);
});

export default db;
