import Pool from '../pool';

export async function getPhoneNumbers(req, res) {
	const { personId } = req.query;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE
			(person_id = $1)
	`;

	try {
		const result = await pool.query(query, [
			personId,
		]);

		pool.end();

		const phoneNumbers = result.rows;

		res.json(phoneNumbers);
	} catch (error) {
		console.log(error);
	}
}

export async function getPhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE id = $1
	`;

	try {
		const result = await pool.query(query, [
			phoneNumberId,
		]);

		pool.end();

		const phoneNumber = result.rows[0];

		if (!phoneNumber) {
			res.status(404).json({ error: 'Phone number not found' });
		}

		res.json(phoneNumber);
	} catch (error) {
		console.log(error)
	}
}

export async function updatePhoneNumber(req, res) {
	const {
		label,
		number,
	} = req.body;

	const { phoneNumberId } = req.params;

	const pool = new Pool();

	const editPhoneNumberQuery = `
		UPDATE PhoneNumbers
		SET updated_at = NOW(),
			label = $1,
			number = $2
		WHERE id = $3
	`;

	try {
		await pool.query(editPhoneNumberQuery, [
			label,
			number,
			phoneNumberId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function createPhoneNumber(req, res) {
	const {
		label,
		number,
		personId,
	} = req.body;

	const pool = new Pool();

	const addPhoneNumberQuery = `
		INSERT INTO PhoneNumbers(
			label,
			number,
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
		const result = await pool.query(addPhoneNumberQuery, [
			label,
			number,
			personId,
		]);
		pool.end();

		const phoneNumberId = result.rows[0].id;
		res.json(phoneNumberId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	const pool = new Pool();

	const query = `
		DELETE FROM PhoneNumbers
		WHERE id = $1
	`;

	try {
		await pool.query(query, [
			phoneNumberId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
