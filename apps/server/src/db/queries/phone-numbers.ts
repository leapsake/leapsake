import { eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { phoneNumbers } from '../schema/phone-numbers.js';

export async function getPhoneNumbers(req, res) {
	const { personId } = req.query;

	try {
		const result = await db
			.select()
			.from(phoneNumbers)
			.where(eq(phoneNumbers.personId, personId));

		res.json(result);
	} catch (error) {
		console.log(error);
	}
}

export async function getPhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	try {
		const result = await db
			.select()
			.from(phoneNumbers)
			.where(eq(phoneNumbers.id, phoneNumberId));

		const phoneNumber = result[0];

		if (!phoneNumber) {
			res.status(404).json({ error: 'Phone number not found' });
		}

		res.json(phoneNumber);
	} catch (error) {
		console.log(error)
	}
}

export async function updatePhoneNumber(req, res) {
	const {
		label,
		number,
	} = req.body;

	const { phoneNumberId } = req.params;

	try {
		await db
			.update(phoneNumbers)
			.set({
				updatedAt: new Date(),
				label,
				number,
			})
			.where(eq(phoneNumbers.id, phoneNumberId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function createPhoneNumber(req, res) {
	const {
		label,
		number,
		personId,
	} = req.body;

	try {
		const result = await db
			.insert(phoneNumbers)
			.values({
				label,
				number,
				personId,
			})
			.returning({ id: phoneNumbers.id });

		const phoneNumberId = result[0].id;
		res.json(phoneNumberId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePhoneNumber(req, res) {
	const { phoneNumberId } = req.params;

	try {
		await db
			.delete(phoneNumbers)
			.where(eq(phoneNumbers.id, phoneNumberId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
