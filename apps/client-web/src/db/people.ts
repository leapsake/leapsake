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

export async function readPerson(id: string) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM People WHERE id = ?`, [ id ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export async function editPerson(id: string, formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const familyName = formData.get('family_name');

	db.run(`
		UPDATE People
		SET updated_at = datetime('now'), given_name = ?, family_name = ?
		WHERE id = ?
	`, [
		givenName,
		familyName,
		id
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${id}`);
}

export async function addPerson(formData: FormData) {
	'use server'

	const givenName = formData.get('given_name');
	const familyName = formData.get('family_name');
	const peopleId = uuidv4();
	const dateableId = uuidv4();

	db.serialize(() => {
		db.run(`INSERT INTO Dateables(id) VALUES(?)`, [
			dateableId,
		], (err) => {
			if (err) {
				console.error(err);
			}
		});

		db.run(`INSERT INTO People(id, given_name, family_name, dateable_id) VALUES(?, ?, ?, ?)`, [
			peopleId,
			givenName,
			familyName,
			dateableId,
		], (err) => {
			if (err) {
				console.error(err);
			}
		});
	});

	redirect(`/people/${peopleId}`);
}

export async function deletePerson(id: string) {
	'use server'

	db.run(`
		DELETE FROM People
		WHERE id = ?
	`, [
		id
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect('/people');
}

