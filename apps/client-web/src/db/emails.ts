import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browseEmailAddresses(personId: string) {
	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE
			(person_id = ?)
	`;

	const emailAddresses = await new Promise((resolve, reject) => {
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

	return emailAddresses;
}

export async function readEmailAddress(emailAddressId: string) {
	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE id = ?
	`;

	const emailAddress = await new Promise((resolve, reject) => {
		db.get(query, [ emailAddressId ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});

	return emailAddress;
}

export async function editEmailAddress(emailAddressId: string, personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label');
	const address = formData.get('address');


	const editEmailAddressQuery = `
		UPDATE EmailAddresses
		SET updated_at = datetime('now'),
			address = ?,
			label = ?,
		WHERE id = ?
	`;

	db.run(editEmailAddressQuery,
		[
			address,
			label,
			emailAddressId
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

export async function addEmailAddress(personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label');
	const address = formData.get('address');
	const emailAddressId = uuidv4();

	const addEmailAddressQuery = `
		INSERT INTO EmailAddresses(
			id,
			address,
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

	db.run(addEmailAddressQuery, [
		emailAddressId,
		address,
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

export async function deleteEmailAddress(emailAddressId: string, personId: string) {
	'use server'

	const query = `
		DELETE FROM EmailAddresses
		WHERE id = ?
	`;

	db.run(query, [
		emailAddressId
	], (err) => {
		if (err) {
			console.error(err);
		}
	});

	redirect(`/people/${personId}`);
}
