import Pool from './init.ts';

export async function getEmailAddresses(req, res) {
	const { personId } = req.query;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE
			(person_id = $1)
	`;

	try {
		const result = await pool.query(query, [
			personId,
		]);
		pool.end();
		
		const emailAddresses = result.rows;

		res.json(emailAddresses);
	} catch (error) {
		console.log(error);
	}
}

export async function getEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE id = $1
	`;

	try {
		const result = await pool.query(query, [
			emailAddressId,
		]);

		pool.end();

		const emailAddress = result.rows[0];

		if (!emailAddress) {
			res.status(404).json({ error: 'Email address not found' });
		}

		res.json(emailAddress);
	} catch (error) {
		console.log(error)
	}
}

export async function updateEmailAddress(req, res) {
	const {
		address,
		label,
	} = req.body;

	const { emailAddressId } = req.params;

	const pool = new Pool();

	const editEmailAddressQuery = `
		UPDATE EmailAddresses
		SET updated_at = NOW(),
			address = $1,
			label = $2
		WHERE id = $3
	`;

	try {
		await pool.query(editEmailAddressQuery, [
			address,
			label,
			emailAddressId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function createEmailAddress(req, res) {
	const {
		address,
		label,
		personId,
	} = req.body;

	const pool = new Pool();

	const addEmailAddressQuery = `
		INSERT INTO EmailAddresses(
			address,
			label,
			person_id
		)
		VALUES(
			$1,
			$2,
			$3
		)
		RETURNING id
	`;
	
	try {
		const result = await pool.query(addEmailAddressQuery, [
			address,
			label,
			personId,
		]);
		pool.end();

		const emailAddressId = result.rows[0].id;
		res.json(emailAddressId);
	} catch (error) {
		console.log(error);
	}
}

export async function deleteEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	const pool = new Pool();

	const query = `
		DELETE FROM EmailAddresses
		WHERE id = $1
	`;

	try {
		await pool.query(query, [
			emailAddressId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
