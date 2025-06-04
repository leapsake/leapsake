import { v4 as uuidv4 } from 'uuid';
import db from './init.ts';

// TODO Implement
async function updatePerson() {
	return Promise.resolve(true);
}

export async function getPhoneNumbers(req, res) {
	const { personId } = req.query;

	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE
			(person_id = $personId)
	`;

	try {
		const phoneNumbers = await new Promise((resolve, reject) => {
			db.all(
				query,
				{
					$personId: personId,
				},
				(err, rows) => {
					if (err) {
						reject(err);
					} else {
						resolve(rows);
					}
				}
			);
		});

		res.json(phoneNumbers);
	} catch (error) {
		console.log(error);
	}
}

export async function getPhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE id = $phoneNumberId
	`;

	try {
		const phoneNumber = await new Promise((resolve, reject) => {
			db.get(
				query,
				{
					$phoneNumberId: phoneNumberId,
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

	const editPhoneNumberQuery = `
		UPDATE PhoneNumbers
		SET updated_at = datetime('now'),
			label = $label,
			number = $number
		WHERE id = $phoneNumberId
	`;

	try {
		db.run(
			editPhoneNumberQuery,
			{
				$label: label,
				$number: number,
				$phoneNumberId: phoneNumberId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

		const personId = null;
		await updatePerson(personId);
		
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

	const phoneNumberId = uuidv4();

	const addPhoneNumberQuery = `
		INSERT INTO PhoneNumbers(
			id,
			label,
			number,
			person_id
		)
		VALUES(
			$phoneNumberId,
			$label,
			$number,
			$personId
		)
	`;

	db.run(
		addPhoneNumberQuery,
		{
			$label: label,
			$number: number,
			$personId: personId,
			$phoneNumberId: phoneNumberId,
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	await updatePerson(personId);

	res.json(phoneNumberId);
}

export async function deletePhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	const query = `
		DELETE FROM PhoneNumbers
		WHERE id = $phoneNumberId
	`;

	db.run(
		query,
		{
			$phoneNumberId: phoneNumberId,
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	res.json(true);
}
