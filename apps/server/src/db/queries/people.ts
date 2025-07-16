import { asc, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { people } from '../schema/people.js';

export async function getPeople(req, res) {
	try {
		const result = await db
			.select()
			.from(people)
			.orderBy(asc(people.familyName), asc(people.givenName));

		res.json(result);
	} catch (error) {
		console.log(error);
	}
}

export async function getPerson(req, res) {
	const { personId } = req.params;

	try {
		const result = await db
			.select()
			.from(people)
			.where(eq(people.id, personId));

		const person = result[0];

		if (!person) {
			res.status(404).json({ error: 'Person not found' });
		}

		res.json(person);
	} catch (error) {
		console.log(error);
	}
}

export async function createPerson(req, res) {
	const {
		familyName,
		givenName,
		maidenName,
		middleName,
	} = req.body;

	try {
		const result = await db
			.insert(people)
			.values({
				familyName,
				givenName,
				maidenName,
				middleName,
			})
			.returning({ id: people.id });

		const personId = result[0].id;

		res.json(personId);
	} catch (error) {
		console.log(error);
	}
}

export async function updatePerson(req, res) {
	const { personId } = req.params;

	const {
		familyName,
		givenName,
		maidenName,
		middleName,
	} = req.body;

	try {
		await db
			.update(people)
			.set({
				updatedAt: new Date(),
				familyName,
				givenName,
				maidenName,
				middleName,
			})
			.where(eq(people.id, personId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePerson(req, res) {
	const { personId } = req.params;

	try {
		await db
			.delete(people)
			.where(eq(people.id, personId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
