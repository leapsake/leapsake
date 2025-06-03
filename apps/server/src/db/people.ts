import { v4 as uuidv4 } from 'uuid';
import db from './init.ts';

export async function getPeople(req, res) {
	const query = `
		SELECT *
		FROM People
		ORDER BY family_name ASC, given_name ASC
	`;

	try {
		const people = await new Promise((resolve, reject) => {
			db.all(query,
				(err, rows) => {
					if (err) {
						reject(err);
					} else {
						resolve(rows);
					}
				}
			);
		});

		res.json(people);
	} catch (err) {
		console.log(err);
	}
}

export async function getPerson(req, res) {
	const { personId } = req.params;

	const query = `
		SELECT *
		FROM People
		WHERE id = $personId
	`;

	try {
		const person = await new Promise((resolve, reject) => {
			db.get(
				query,
				{
					$personId: personId,
				},
				(err, row) => {
					if (err) {
						reject(err);
					} else {
						resolve(row);
					}
				}
			);
		});

		if (!person) {
			res.status(404).json({ error: 'Person not found' });
		}

		res.json(person);
	} catch (err) {
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

	const personId = uuidv4();

	const query = `
		INSERT INTO People(
			family_name,
			given_name,
			maiden_name,
			middle_name,
			id
		)
		VALUES(
			$familyName,
			$givenName,
			$maidenName,
			$middleName,
			$personId
		)
	`;

	try {
		db.run(
			query,
			{
				$familyName: familyName,
				$givenName: givenName,
				$maidenName: maidenName,
				$middleName: middleName,
				$personId: personId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

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

	const query = `
		UPDATE People
		SET updated_at = datetime('now'),
			family_name = $familyName,
			given_name = $givenName,
			maiden_name = $maidenName,
			middle_name = $middleName
		WHERE id = $personId
	`;

	try {
		db.run(
			query,
			{
				$familyName: familyName,
				$givenName: givenName,
				$maidenName: maidenName,
				$middleName: middleName,
				$personId: personId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

		res.json(personId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePerson(req, res) {
	const { personId } = req.params;

	const query = `
		DELETE FROM People
		WHERE id = $personId
	`;

	try {
		db.run(
			query,
			{
				$personId: personId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
