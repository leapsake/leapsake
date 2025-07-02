import { Pool as PgPool } from 'pg';

class Pool extends PgPool {
	constructor() {
		super();

		return new PgPool({
			database: process.env.POSTGRES_DB,
			host: process.env.POSTGRES_HOST,
			password: process.env.POSTGRES_PASSWORD,
			port: parseInt(process.env.POSTGRES_PORT || '5432'),
			user: process.env.POSTGRES_USER,
		});
	}
}

export default Pool;
