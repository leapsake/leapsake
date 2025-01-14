import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browseMilestones(personId: string) {
	const query = `
		SELECT *
		FROM Milestones
		WHERE
			(person_id = ?)
		ORDER BY year ASC, month ASC, day ASC
	`;

	const milestones = await new Promise((resolve, reject) => {
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
	return milestones;
}

export async function readMilestone(milestoneId: string) {
	const query = `
		SELECT *
		FROM Milestones
		WHERE id = ?
	`;

	const person = await new Promise((resolve, reject) => {
		db.get(query, [ milestoneId ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export async function editMilestone(milestoneId: string, personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day');
	const label = formData.get('label');
	const month = formData.get('month');
	const year = formData.get('year');


	const editMilestoneQuery = `
		UPDATE Milestones
		SET updated_at = datetime('now'),
			day = ?,
			label = ?,
			month = ?,
			year = ?
		WHERE id = ?
	`;

	db.run(editMilestoneQuery,
		[
			day,
			label,
			month,
			year,
			milestoneId
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

export async function addMilestone(personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day');
	const label = formData.get('label');
	const month = formData.get('month');
	const year = formData.get('year');
	const milestoneId = uuidv4();

	const addMilestoneQuery = `
		INSERT INTO Milestones(
			id,
			day,
			label,
			month,
			person_id,
			year
		)
		VALUES(
			?,
			?,
			?,
			?,
			?,
			?
		)
	`;

	db.run(addMilestoneQuery, [
		milestoneId,
		day,
		label,
		month,
		personId,
		year,
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
