import { v4 as uuidv4 } from 'uuid';
import db from './init.ts';

// TODO Implement
async function updatePerson() {
	return Promise.resolve(true);
}

export async function getEmailAddresses(req, res) {
	const { personId } = req.query;

	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE
			(person_id = $personId)
	`;

	try {
		const emailAddresses = await new Promise((resolve, reject) => {
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

		res.json(emailAddresses);
	} catch (error) {
		console.log(error);
	}
}

export async function getEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE id = $emailAddressId
	`;

	try {
		const emailAddress = await new Promise((resolve, reject) => {
			db.get(
				query,
				{
					$emailAddressId: emailAddressId,
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

	const editEmailAddressQuery = `
		UPDATE EmailAddresses
		SET updated_at = datetime('now'),
			address = $address,
			label = $label
		WHERE id = $emailAddressId
	`;

	try {
		db.run(
			editEmailAddressQuery,
			{
				$address: address,
				$label: label,
				$emailAddressId: emailAddressId,
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

export async function createEmailAddress(req, res) {
	const {
		address,
		label,
		personId,
	} = req.body;

	const emailAddressId = uuidv4();

	const addEmailAddressQuery = `
		INSERT INTO EmailAddresses(
			address,
			id,
			label,
			person_id
		)
		VALUES(
			$address,
			$emailAddressId,
			$label,
			$personId
		)
	`;

	db.run(
		addEmailAddressQuery,
		{
			$emailAddressId: emailAddressId,
			$address: address,
			$label: label,
			$personId: personId,
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	await updatePerson(personId);

	res.json(emailAddressId);
}

export async function deleteEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	const query = `
		DELETE FROM EmailAddresses
		WHERE id = $emailAddressId
	`;

	db.run(
		query,
		{
			$emailAddressId: emailAddressId,
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	res.json(true);
}
