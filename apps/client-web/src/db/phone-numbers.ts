import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browsePhoneNumbers(personId: string) {
	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE
			(person_id = ?)
	`;

	const phoneNumbers = await new Promise((resolve, reject) => {
		db.all(query,
			[ personId ],
			(err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows);
			}
		});
	});

	return phoneNumbers;
}

export async function readPhoneNumber(phoneNumberId: string) {
	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE id = ?
	`;

	const phoneNumber = await new Promise((resolve, reject) => {
		db.get(query, [ phoneNumberId ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});

	return phoneNumber;
}

export async function editPhoneNumber(phoneNumberId: string, personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label');
	const number = formData.get('number');


	const editPhoneNumberQuery = `
		UPDATE PhoneNumbers
		SET updated_at = datetime('now'),
			number = ?,
			label = ?
		WHERE id = ?
	`;

	db.run(editPhoneNumberQuery,
		[
			number,
			label,
			phoneNumberId
		],
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	const updatePersonUpdatedAtQuery = `
		UPDATE People
		SET updated_at = datetime('now')
		WHERE id = ?
	`;

	db.run(updatePersonUpdatedAtQuery,
		[ personId ], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}

export async function addPhoneNumber(personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label');
	const number = formData.get('number');
	const phoneNumberId = uuidv4();

	const addPhoneNumberQuery = `
		INSERT INTO PhoneNumbers(
			id,
			number,
			label,
			person_id
		)
		VALUES(
			?,
			?,
			?,
			?
		)
	`;

	db.run(addPhoneNumberQuery, [
		phoneNumberId,
		number,
		label,
		personId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	const updatePersonUpdatedAtQuery = `
		UPDATE People
		SET updated_at = datetime('now')
		WHERE id = ?
	`;

	db.run(updatePersonUpdatedAtQuery,
		[ personId ], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}

export async function deletePhoneNumber(phoneNumberId: string, personId: string) {
	'use server'

	const query = `
		DELETE FROM PhoneNumbers
		WHERE id = ?
	`;

	db.run(query, [
		phoneNumberId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}
