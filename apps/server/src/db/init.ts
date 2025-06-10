import { Pool as PgPool } from 'pg';

class Pool {
	constructor() {
		return new PgPool({
			database: process.env.POSTGRES_DB,
			host: process.env.POSTGRES_HOST,
			password: process.env.POSTGRES_PASSWORD,
			port: process.env.POSTGRES_PORT,
			user: process.env.POSTGRES_USER,
		});
	}
}

const pool = new Pool();

pool.query(`
	BEGIN;

	CREATE TABLE IF NOT EXISTS People(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		family_name TEXT,
		given_name TEXT,
		maiden_name TEXT,
		middle_name TEXT
	);

	CREATE TABLE IF NOT EXISTS Milestones(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		day TEXT,
		label TEXT,
		month TEXT,
		person_id TEXT,
		year TEXT
	);

	CREATE TABLE IF NOT EXISTS EmailAddresses(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		address TEXT,
		label TEXT,
		person_id TEXT
	);

	CREATE TABLE IF NOT EXISTS PhoneNumbers(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		label TEXT,
		number TEXT,
		person_id TEXT
	);

	CREATE TABLE IF NOT EXISTS Photos(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		alt TEXT,
		description TEXT,
		path TEXT
	);

	CREATE TABLE IF NOT EXISTS PhotoAlbums(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		description TEXT
	);

	CREATE TABLE IF NOT EXISTS PhotoAlbumItems(
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		photo_id TEXT,
		photo_album_id TEXT
	);

	COMMIT;
`);

pool.end();

export default Pool;
