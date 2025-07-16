import { asc, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { milestones } from '../schema/milestones.js';

export async function getMilestones(req, res) {
	const { personId } = req.query;

	try {
		const result = await db
			.select()
			.from(milestones)
			.where(eq(milestones.personId, personId))
			.orderBy(asc(milestones.year), asc(milestones.month), asc(milestones.day));

		res.json(result);
	} catch (error) {
		console.log(error);
	}
}

export async function getMilestone(req, res) {
	const { milestoneId } = req.params;

	try {
		const result = await db
			.select()
			.from(milestones)
			.where(eq(milestones.id, milestoneId));

		const milestone = result[0];

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

	try {
		await db
			.update(milestones)
			.set({
				updatedAt: new Date(),
				day,
				label,
				month,
				year,
			})
			.where(eq(milestones.id, milestoneId));

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

	try {
		const result = await db
			.insert(milestones)
			.values({
				day,
				label,
				month,
				personId,
				year,
			})
			.returning({ id: milestones.id });

		const milestoneId = result[0].id;
		res.json(milestoneId);
	} catch (error) {
		console.log(error);
	}
}

export async function deleteMilestone(req, res) {
	const { milestoneId } = req.params;

	try {
		await db
			.delete(milestones)
			.where(eq(milestones.id, milestoneId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
