import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import initDB from './init';

const dataDir = path.resolve('data');
const databasePath = path.resolve(dataDir, 'development.db');

if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir);
}

const db = new sqlite3.Database(databasePath);

initDB(db);

export default db;
