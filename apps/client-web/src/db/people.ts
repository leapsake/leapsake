import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browsePeople() {
	const people = await new Promise((resolve, reject) => {
		db.all(`SELECT * FROM People ORDER BY family_name ASC, given_name ASC`, (err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows);
			}
		});
	});
	return people;
}

export async function readPerson(personId: string) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM People WHERE id = ?`, [ personId ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export async function editPerson(personId: string, formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const middleName = formData.get('middle_name');
	const familyName = formData.get('family_name');

	// console.log(Object.keys(Object.fromEntries(formData)));

	db.run(`
		UPDATE People
		SET updated_at = datetime('now'),
			given_name = ?,
			middle_name = ?,
			family_name = ?
		WHERE id = ?
	`, [
		givenName,
		middleName,
		familyName,
		personId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}

export async function addPerson(formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const middleName = formData.get('middle_name');
	const familyName = formData.get('family_name');
	const personId = uuidv4();

	db.serialize(() => {
		db.run(`INSERT INTO People(id, given_name, middle_name, family_name) VALUES(?, ?, ?, ?)`, [
			personId,
			givenName,
			middleName,
			familyName,
		], (err) => {
			if (err) {
				console.error(err);
			}
		});
	});

	redirect(`/people/${personId}`);
}

export async function deletePerson(personId: string) {
	'use server'

	db.run(`
		DELETE FROM People
		WHERE id = ?
	`, [
		personId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect('/people');
}

