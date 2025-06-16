import { Umzug } from 'umzug';
import Pool from './pool';
import url from 'url';
import path from 'path';
import fs from 'fs/promises';

const pool = new Pool();

class PostgreSQLStorage {
	constructor(options) {
		this.pool = options.pool;
		this.tableName = options.tableName || 'Migrations';
	}

	async logMigration({ name }) {
		await this.pool.query(
			`INSERT INTO ${this.tableName} (name, executed_at) VALUES ($1, NOW())`,
			[ name ]
		);
	}

	async unlogMigration({ name }) {
		await this.pool.query(
			`DELETE FROM ${this.tableName} WHERE name = $1`,
			[ name ]
		);
	}

	async executed() {
		await this._ensureTable();
		const result = await this.pool.query(
			`SELECT name FROM ${this.tableName} ORDER BY executed_at ASC`
		);
		const rowNames = result.rows.map((row) => row.name);
		return rowNames;
	}

	async _ensureTable() {
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS ${this.tableName} (
				id SERIAL PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				executed_AT TIMESTAMPTZ DEFAULT NOW()
			)
		`);
	}
}

async function executeSqlInTransaction(pool, sql) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');

		const statements = sql
			.split(';')
			.map((statement) => statement.trim())
			.filter((statement) => statement.length > 0);

		for (const statement of statements) {
			await client.query(statement);
		}

		await client.query('COMMIT');
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

async function getRunMigration(context, direction, path) {
	return async () => {
		try {
			const sql = fs.readFile(path, 'utf8');
			await executeSqlInTransaction(context.pool, sql);;
		} catch (error) {
			throw new Error(`Failed to execute ${direction} migration ${baseName}: ${error.message}`);
		}
	};
}

const umzug = new Umzug({
	migrations: {
		glob: path.join('migrations', '*.up.sql'),
		resolve: async ({ name, path: upPath, context }) => {
			const baseName = name.replace('.up.sql', '');
			const downPath = upPath.replace('.up.sql', '.down.sql');
			
			return {
				name: baseName,
				up: getRunMigration(context, 'up', upPath),
				down: getRunMigration(context, 'down', downPath),
			};
		}
	},
	context: { pool },
	storage: new PostgreSQLStorage({ pool }),
	logger: console,
});

// CLI
async function main() {
	const command = process.argv[2];

	try {
		switch (command) {
			case 'up':
				const upResult = await umzug.up();
				
				if (upResult.length === 0) {
					console.log('No pending migrations to execute');
				} else {
					console.log(`Executed ${upResult.length} migration(s) successfully:`);
					upResult.forEach((migration) => {
						console.log(migration.name);
					});
				}
				break;

			case 'down'
				const downResult = await umzug.down();
				if (downResult.length === 0) {
					console.log('No migrations to roll back');
				} else {
					console.log(`Rolled back migration: ${downResult[0].name}`);
				}
				break;

			case 'status':
				const executed = await umzug.executed();
				const pending = await umzug.pending();

				console.log('Migration Status:');
				console.log('* * * * *');

				if (executed.length > 0) {
					console.log('\nExecuted migrations:');
					executed.forEach((migration) => {
						console.log(migration.name);
					});
				} else {
					console.log('\nNo executed migrations');
				}

				if (pending.length > 0) {
					console.log('\nPending migrations:');
					pending.forEach((migration) => {
						console.log(migration.name);
					});
				} else {
					console.log('\nNo pending migrations');
				}
				break;

			case 'create':
				const migraionName = process.argv[3];

				if (!migrationName) {
					console.error('Need a migration name');
					process.exit(1);
				}
				await createMigration(migrationName);
				break;

			default:
				console.log('Need an argument');
		}
	} catch (error) {
		console.error('Migration failed:', error.message);
		process.exit(1);
	} finally {
		await pool.end();
	}
}

async function createMigration(name) {
	const timestamp = new Date().toISOString().replace(/[-T:]/g, '').split('.')[0];
	const baseName = `${timestamp}_${name}`;

	// TODO: generate paths
	// ex. const upPath = path.join(__dirname, 'migrations', `${baseName}.up.sql`);
	// const downPath = path.join(__dirname, 'migrations', `${baseName}.down.sql`);
	const upPath = '';
	const downPath = '';

	const upTemplate = `-- Migration: ${name} (UP)
	-- Created: ${new Date().toISOString()}

	-- Add up migration SQL here
	`;

	const downTemplate = `-- Migration: ${name} (DOWN)
	-- Created: ${new Date().toISOString()}

	-- Add down migration SQL here
	-- (Should reverse up migration)
	`;

	try {
		await writeFile(upPath, upTemplate);
		await writeFile(downPath, downTemplate);

		console.log('Created migration files');
	} catch (error) {
		console.error('Failed to create migration files:', error.message);
		process.exit(1);
	}
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
	await main();
}

export { umzug, pool };
