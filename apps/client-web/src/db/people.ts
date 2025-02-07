import { v4 as uuidv4 } from 'uuid';
import { Person } from '@/types';
import db from '@/db';

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
		WHERE id = $personId
	`;

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

	return person;
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
			family_name = $familyName,
			given_name = $givenName,
			maiden_name = $maidenName,
			middle_name = $middleName
		WHERE id = $personId
	`;

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

	return personId;
}

export async function deletePerson(personId: string) {
	const query = `
		DELETE FROM People
		WHERE id = $personId
	`;

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

	return null;
}

