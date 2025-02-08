import { v4 as uuidv4 } from 'uuid';
import db from '@/db';
import { PhoneNumber } from '@/types';
import { updatePerson } from '@/db/people';

export async function browsePhoneNumbers(personId: string) {
	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE
			(person_id = $personId)
	`;

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

	return phoneNumbers;
}

export async function readPhoneNumber(phoneNumberId: string) {
	const query = `
		SELECT *
		FROM PhoneNumbers
		WHERE id = $phoneNumberId
	`;

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

	return phoneNumber;
}

export async function editPhoneNumber(phoneNumberId: string, personId: string, {
	label,
	number,
}: PhoneNumber) {
	const editPhoneNumberQuery = `
		UPDATE PhoneNumbers
		SET updated_at = datetime('now'),
			number = $number,
			label = $label
		WHERE id = $phoneNumberId
	`;

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

	await updatePerson(personId);

	return null;
}

export async function addPhoneNumber(personId: string, {
	label,
	number,
}: PhoneNumber) {
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

	return phoneNumberId;
}

export async function deletePhoneNumber(phoneNumberId: string) {
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
}
