import db from '@/db';
import { v4 as uuidv4 } from 'uuid';

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

type Person = {
	familyName: string,
	givenName: string,
	maidenName: string,
	middleName: string,
}

export async function editPerson(personId: string, {
	familyName,
	givenName,
	maidenName,
	middleName,
}: Person) {
	const query = `
		UPDATE People
		SET updated_at = datetime('now'),
			family_name = ?,
			given_name = ?,
			maiden_name = ?,
			middle_name = ?
		WHERE id = ?
	`;

	db.run(query,
		[
			familyName,
			givenName,
			maidenName,
			middleName,
			personId
		],
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	return null;
}

export async function addPerson({
	familyName,
	givenName,
	maidenName,
	middleName,
}: Person) {
	const personId = uuidv4();

	const query = `
		INSERT INTO People(
			id,
			family_name,
			given_name,
			maiden_name,
			middle_name
		)
		VALUES(
			?,
			?,
			?,
			?,
			?
		)
	`;

	db.run(query, [
		personId,
		familyName,
		givenName,
		maidenName,
		middleName,
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	return personId;
}

export async function deletePerson(personId: string) {
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

	return null;
}

