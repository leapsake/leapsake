import fs from 'fs';
import express from 'express';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import * as handlers from './handlers';

const dataDir = path.resolve('data');
const databasePath = path.resolve(dataDir, 'development.db');
const db = new sqlite3.Database(databasePath);
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir);
}

const app = express();

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
	res.send({ message: 'Welcome to server!' });
});

app.get('/people', handlers.peopleHandler);

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
