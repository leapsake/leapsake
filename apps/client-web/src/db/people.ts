import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browsePeople() {
	const query = `
		SELECT *
		FROM People
		ORDER BY family_name ASC, given_name ASC
	`;

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

	return people;
}

export async function readPerson(personId: string) {
	const query = `
		SELECT *
		FROM People
		WHERE id = ?
	`;

	const person = await new Promise((resolve, reject) => {
		db.get(query,
			[ personId ],
			(err, row) => {
				if (err) {
					reject(err);
				} else {
					resolve(row);
				}
			}
		);
	});

	return person;
}

export async function editPerson(personId: string, formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const middleName = formData.get('middle_name');
	const familyName = formData.get('family_name');

	const query = `
		UPDATE People
		SET updated_at = datetime('now'),
			given_name = ?,
			middle_name = ?,
			family_name = ?
		WHERE id = ?
	`;

	db.run(query,
		[
			givenName,
			middleName,
			familyName,
			personId
		],
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	redirect(`/people/${personId}`);
}

export async function addPerson(formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const middleName = formData.get('middle_name');
	const familyName = formData.get('family_name');
	const personId = uuidv4();

	const query = `
		INSERT INTO People(
			id,
			given_name,
			middle_name,
			family_name
		)
		VALUES(
			?,
			?,
			?,
			?
		)
	`;

	db.run(query, [
		personId,
		givenName,
		middleName,
		familyName,
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}

export async function deletePerson(personId: string) {
	'use server'

	const query = `
		DELETE FROM People
		WHERE id = ?
	`;

	db.run(query, [
		personId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect('/people');
}

