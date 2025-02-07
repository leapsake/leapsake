import { v4 as uuidv4 } from 'uuid';
import { EmailAddress } from '@/types';
import db from '@/db';

export async function browseEmailAddresses(personId: string) {
	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE
			(person_id = $personId)
	`;

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

	return emailAddresses;
}

export async function readEmailAddress(emailAddressId: string) {
	const query = `
		SELECT *
		FROM EmailAddresses
		WHERE id = $emailAddressId
	`;

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

	return emailAddress;
}

export async function editEmailAddress(emailAddressId: string, personId: string, {
	address,
	label,
}: EmailAddress) {
	const editEmailAddressQuery = `
		UPDATE EmailAddresses
		SET updated_at = datetime('now'),
			address = $address,
			label = $label
		WHERE id = $emailAddressId
	`;

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

	const updatePersonUpdatedAtQuery = `
		UPDATE People
		SET updated_at = datetime('now')
		WHERE id = $personId
	`;

	db.run(
		updatePersonUpdatedAtQuery,
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

export async function addEmailAddress(personId: string, {
	address,
	label,
}: EmailAddress) {
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

	const updatePersonUpdatedAtQuery = `
		UPDATE People
		SET updated_at = datetime('now')
		WHERE id = $personId
	`;

	db.run(
		updatePersonUpdatedAtQuery,
		{
			$personId: personId
		},
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	return emailAddressId;
}

export async function deleteEmailAddress(emailAddressId: string) {
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

	return null;
}
