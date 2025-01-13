import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import { redirect } from 'next/navigation';

export async function browseMilestones() {
	const milestones = await new Promise((resolve, reject) => {
		db.all(`SELECT * FROM Milestones`, (err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows);
			}
		});
	});
	return milestones;
}

export async function readMilestone(id: string) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM Milestones WHERE id = ?`, [ id ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export async function addMilestone(personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day');
	const label = formData.get('label') || null;
	const month = formData.get('month');
	const type = formData.get('type');
	const year = formData.get('year');
	const milestoneId = uuidv4();

	db.serialize(() => {
		db.run(`INSERT INTO Milestones(id, day, label, month, person_id, type, year) VALUES(?, ?, ?, ?, ?, ?, ?)`, [
			milestoneId,
			day,
			label,
			month,
			personId,
			type,
			year,
		], (err) => {
			if (err) {
				console.error(err);
			}
		});
	});

	redirect(`/people/${personId}`);
}
