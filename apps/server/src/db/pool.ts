import { Pool as PgPool } from 'pg';

class Pool {
	constructor(options = {
		database: null,
		host: null,
		password: null,
		port: null,
		user: null,
	}) {
		return new PgPool({
			database: options.database || process.env.POSTGRES_DB,
			host: options.host || process.env.POSTGRES_HOST,
			password: options.password || process.env.POSTGRES_PASSWORD,
			port: options.port || process.env.POSTGRES_PORT,
			user: options.user || process.env.POSTGRES_USER,
		});
	}
}

export default Pool;
