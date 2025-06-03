import { v4 as uuidv4 } from 'uuid';
import db from './init.ts';

// TODO Implement
async function updatePerson() {
	return Promise.resolve(true);
}

export async function getMilestones(req, res) {
	const { personId } = req.query;

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

	res.json(milestones);
}

export async function getMilestone(req, res) {
	const { milestoneId } = req.params;

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

	res.json(milestone);
}

export async function updateMilestone(req, res) {
	const {
		day,
		label,
		month,
		year,
	} = req.body;

	const { milestoneId } = req.params;

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

	// TODO: Update person "last updated"
	const personId = null;
	await updatePerson(personId);

	res.json(true);
}

export async function createMilestone(req, res) {
	const {
		day,
		label,
		month,
		year,
		personId,
	} = req.body;

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

	// TODO: Update person "last updated"
	await updatePerson(personId);

	res.json(milestoneId);
}

export async function deleteMilestone(req, res) {
	const { milestoneId } = req.params;

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

	res.json(true);
}
