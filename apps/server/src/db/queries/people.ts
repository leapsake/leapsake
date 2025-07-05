import Pool from '../pool.js';

export async function getPeople(req, res) {
	const pool = new Pool();

	const query = `
		SELECT *
		FROM People
		ORDER BY family_name ASC, given_name ASC
	`;

	try {
		const result = await pool.query(query);
		pool.end();

		const people = result.rows;

		res.json(people);
	} catch (error) {
		console.log(error);
	}
}

export async function getPerson(req, res) {
	const { personId } = req.params;
	const pool = new Pool();

	const query = `
		SELECT *
		FROM People
		WHERE id = $1
	`;

	try {
		const result = await pool.query(query, [personId]);
		pool.end();

		const person = result.rows[0];

		if (!person) {
			res.status(404).json({ error: 'Person not found' });
		}

		res.json(person);
	} catch (error) {
		console.log(error);
	}
}

export async function createPerson(req, res) {
	const {
		familyName,
		givenName,
		maidenName,
		middleName,
	} = req.body;

	const pool = new Pool();

	const query = `
		INSERT INTO People(
			family_name,
			given_name,
			maiden_name,
			middle_name
		)
		VALUES(
			$1,
			$2,
			$3,
			$4
		)
		RETURNING id
	`;

	try {
	  	const result = await pool.query(query, [
			familyName,
			givenName,
			maidenName,
			middleName,
		]);
		pool.end();

		const person = result.rows[0];
		const personId = person.id;

		res.json(personId);
	} catch (error) {
		console.log(error);
	}
}

export async function updatePerson(req, res) {
	const { personId } = req.params;

	const {
		familyName,
		givenName,
		maidenName,
		middleName,
	} = req.body;

	const pool = new Pool();

	const query = `
		UPDATE People
		SET updated_at = NOW(),
			family_name = $1,
			given_name = $2,
			maiden_name = $3,
			middle_name = $4
		WHERE id = $5
	`;

	try {
		await pool.query(query, [
			familyName,
			givenName,
			maidenName,
			middleName,
			personId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePerson(req, res) {
	const { personId } = req.params;

	const pool = new Pool();

	const query = `
		DELETE FROM People
		WHERE id = $1
	`;

	try {
		await pool.query(query, [
			personId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
