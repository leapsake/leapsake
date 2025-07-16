import { eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { emailAddresses } from '../schema/email-addresses.js';

export async function getEmailAddresses(req, res) {
	const { personId } = req.query;

	try {
		const result = await db
			.select()
			.from(emailAddresses)
			.where(eq(emailAddresses.personId, personId));

		res.json(result);
	} catch (error) {
		console.log(error);
	}
}

export async function getEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	try {
		const result = await db
			.select()
			.from(emailAddresses)
			.where(eq(emailAddresses.id, emailAddressId));

		const emailAddress = result[0];

		if (!emailAddress) {
			res.status(404).json({ error: 'Email address not found' });
		}

		res.json(emailAddress);
	} catch (error) {
		console.log(error)
	}
}

export async function updateEmailAddress(req, res) {
	const {
		address,
		label,
	} = req.body;

	const { emailAddressId } = req.params;

	try {
		await db
			.update(emailAddresses)
			.set({
				updatedAt: new Date(),
				address,
				label,
			})
			.where(eq(emailAddresses.id, emailAddressId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function createEmailAddress(req, res) {
	const {
		address,
		label,
		personId,
	} = req.body;
	
	try {
		const result = await db
			.insert(emailAddresses)
			.values({
				address,
				label,
				personId,
			})
			.returning({ id: emailAddresses.id });

		const emailAddressId = result[0].id;
		res.json(emailAddressId);
	} catch (error) {
		console.log(error);
	}
}

export async function deleteEmailAddress(req, res) {
	const { emailAddressId } = req.params;

	try {
		await db
			.delete(emailAddresses)
			.where(eq(emailAddresses.id, emailAddressId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}
