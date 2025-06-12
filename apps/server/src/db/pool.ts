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

export default Pool;
