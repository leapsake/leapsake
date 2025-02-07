import { v4 as uuidv4 } from 'uuid';
import { Milestone } from '@/types';
import db from '@/db';

export async function browseMilestones(personId: string) {
	const query = `
		SELECT *
		FROM Milestones
		WHERE
			(person_id = $personId)
		ORDER BY year ASC, month ASC, day ASC
	`;

	const milestones = await new Promise((resolve, reject) => {
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

	return milestones;
}

export async function readMilestone(milestoneId: string) {
	const query = `
		SELECT *
		FROM Milestones
		WHERE id = $milestoneId
	`;

	const milestone = await new Promise((resolve, reject) => {
		db.get(
			query,
			{
				$milestoneId: milestoneId,
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

	return milestone;
}

export async function editMilestone(milestoneId: string, personId: string, {
	day,
	label,
	month,
	year,
}: Milestone) {
	const editMilestoneQuery = `
		UPDATE Milestones
		SET updated_at = datetime('now'),
			day = $day,
			label = $label,
			month = $month,
			year = $year
		WHERE id = $milestoneId 
	`;

	db.run(
		editMilestoneQuery,
		{ 
			$day: day,
			$label: label,
			$month: month,
			$year: year,
			$milestoneId: milestoneId,
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

export async function addMilestone(personId: string, {
	day,
	label,
	month,
	year,
}: Milestone) {
	const milestoneId = uuidv4();

	const addMilestoneQuery = `
		INSERT INTO Milestones(
			day,
			id,
			label,
			month,
			person_id,
			year
		)
		VALUES(
			$day,
			$milestoneId,
			$label,
			$month,
			$personId,
			$year	
		)
	`;

	db.run(
		addMilestoneQuery, 
		{ 
			$day: day,
			$label: label,
			$milestoneId: milestoneId,
			$month: month,
			$personId: personId,
			$year: year,
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

	return milestoneId;
}

export async function deleteMilestone(milestoneId: string) {
	const query = `
		DELETE FROM Milestones
		WHERE id = $milestoneId
	`;

	db.run(
		query, 
		{ 
			$milestoneId: milestoneId,
		}, 
		(err) => {
			if (err) {
				console.error(err);
			}
		}
	);

	return null;
}
