import Pool from '../pool';

export async function getMilestones(req, res) {
	const { personId } = req.query;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM Milestones
		WHERE
			(person_id = $1)
		ORDER BY year ASC, month ASC, day ASC
	`;

	try {
		const result = await pool.query(query, [
			personId,
		]);
		pool.end();

		const milestones = result.rows;

		res.json(milestones);
	} catch (error) {
		console.log(error);
	}
}

export async function getMilestone(req, res) {
	const { milestoneId } = req.params;

	const pool = new Pool();

	const query = `
		SELECT *
		FROM Milestones
		WHERE id = $1
	`;

	try {
		const result = await pool.query(query, [
			milestoneId,
		]);
		pool.end();

		const milestone = result.rows[0];

		if (!milestone) {
			res.status(404).json({ error: 'Milestone not found' });
		}

		res.json(milestone);
	} catch (error) {
		console.log(error);
	}
}

export async function updateMilestone(req, res) {
	const {
		day,
		label,
		month,
		year,
	} = req.body;

	const { milestoneId } = req.params;

	const pool = new Pool();

	const editMilestoneQuery = `
		UPDATE Milestones
		SET updated_at = NOW(),
			day = $1,
			label = $2,
			month = $3,
			year = $4
		WHERE id = $5
	`;

	try {
		await pool.query(editMilestoneQuery, [
			day,
			label,
			month,
			year,
			milestoneId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function createMilestone(req, res) {
	const {
		day,
		label,
		month,
		year,
		personId,
	} = req.body;

	const pool = new Pool();

	const addMilestoneQuery = `
		INSERT INTO Milestones(
			day,
			label,
			month,
			person_id,
			year
		)
		VALUES(
			$1,
			$2,
			$3,
			$4,
			$5
		)
		RETURNING id
	`;

	try {
		const result = await pool.query(addMilestoneQuery, [
			day,
			label,
			month,
			personId,
			year,
		]);
		pool.end();

		const milestoneId = result.rows[0].id;
		res.json(milestoneId);
	} catch (error) {
		console.log(error);
	}
}

export async function deleteMilestone(req, res) {
	const { milestoneId } = req.params;

	const pool = new Pool();

	const query = `
		DELETE FROM Milestones
		WHERE id = $1
	`;

	try {
		await pool.query(query, [
			milestoneId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
