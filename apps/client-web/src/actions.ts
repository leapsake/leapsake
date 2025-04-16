import fs from 'fs/promises';
import path from 'path';
import { redirect } from 'next/navigation';

import * as emailDb from '@/db/emails';
import * as peopleDb from '@/db/people';
import * as photosDb from '@/db/photos';
import * as milestonesDb from '@/db/milestones';
import * as phoneDb from '@/db/phone-numbers';

export async function browsePeople() {
	const people = await peopleDb.browsePeople();
	return people;
}

export async function readPerson(personId: string) {
	const person = await peopleDb.readPerson(personId);
	return person;
}

export async function editPerson(personId: string, formData: FormData) {
	'use server';

	const familyName = formData.get('family_name') as string;
	const givenName = formData.get('given_name') as string;
	const maidenName = formData.get('maiden_name') as string;
	const middleName = formData.get('middle_name') as string;

	await peopleDb.editPerson(personId, {
		familyName,
		givenName,
		maidenName,
		middleName,
	});

	redirect(`/people/${personId}`);
}

export async function addPerson(formData: FormData) {
	'use server'

	const familyName = formData.get('family_name') as string;
	const givenName = formData.get('given_name') as string;
	const maidenName = formData.get('maiden_name') as string;
	const middleName = formData.get('middle_name') as string;

	const personId = await peopleDb.addPerson({
		familyName,
		givenName,
		maidenName,
		middleName,
	});

	redirect(`/people/${personId}`);
}

export async function deletePerson(personId: string) {
	'use server'

	await peopleDb.deletePerson(personId);

	redirect('/people');
}

export async function browseEmailAddresses(personId: string) {
	const emailAddresses = await emailDb.browseEmailAddresses(personId);
	return emailAddresses;
}

export async function readEmailAddress(emailAddressId: string) {
	const emailAddress = await emailDb.readEmailAddress(emailAddressId);
	return emailAddress;
}

export async function editEmailAddress(emailAddressId: string, personId: string, formData: FormData) {
	'use server'

	const address = formData.get('address') as string;
	const label = formData.get('label') as string;

	await emailDb.editEmailAddress(emailAddressId, personId, {
		address,
		label,
	});

	redirect(`/people/${personId}`);
}

export async function addEmailAddress(personId: string, formData: FormData) {
	'use server'

	const address = formData.get('address') as string;
	const label = formData.get('label') as string;

	await emailDb.addEmailAddress(personId, {
		address,
		label,
	});

	redirect(`/people/${personId}`);
}

export async function deleteEmailAddress(emailAddressId: string, personId: string) {
	'use server'

	await emailDb.deleteEmailAddress(emailAddressId);

	redirect(`/people/${personId}`);
}

export async function browsePhotos() {
	const photos = await photosDb.browsePhotos();
	return photos;
}

export async function readPhoto(photoId: string) {
	const photo = await photosDb.readPhoto(photoId);
	return photo;
}

export async function addPhotos(formData: FormData) {
	'use server'

	const photos = formData.getAll('photos');
	const uploadDir = path.resolve('public/files/photos');

	try {
		await fs.access(uploadDir, fs.constants.F_OK);
	} catch {
		try {
			await fs.mkdir(uploadDir, { recursive: true });
		} catch (err) {
			console.error(err);
		}
	}

	await Promise.all(photos.map(async (photo) => {
		const buffer = Buffer.from(await photo.arrayBuffer());
		const absolutePath = path.resolve(uploadDir, photo.name);
		const relativePath = path.resolve('/files/photos/', photo.name);

		await fs.writeFile(
			absolutePath,
			buffer
		);

		await photosDb.addPhoto(relativePath);
	}));

	redirect(`/photos`);
}

export async function browseMilestones(personId: string) {
	const milestones = await milestonesDb.browseMilestones(personId);
	return milestones;
}

export async function readMilestone(milestoneId: string) {
	const milestone = await milestonesDb.readMilestone(milestoneId);
	return milestone;
}

export async function editMilestone(milestoneId: string, personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	await milestonesDb.editMilestone(milestoneId, personId, {
		day,
		label,
		month,
		year,
	});

	redirect(`/people/${personId}`);
}

export async function addMilestone(personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	await milestonesDb.addMilestone(personId, {
		day,
		label,
		month,
		year,
	});

	redirect(`/people/${personId}`);
}

export async function deleteMilestone(milestoneId: string, personId: string) {
	'use server'

	await milestonesDb.deleteMilestone(milestoneId);

	redirect(`/people/${personId}`);
}

export async function browsePhoneNumbers(personId: string) {
	const phoneNumbers = await phoneDb.browsePhoneNumbers(personId);
	return phoneNumbers;
}

export async function readPhoneNumber(phoneNumberId: string) {
	const phoneNumber = await phoneDb.readPhoneNumber(phoneNumberId);
	return phoneNumber;
}

export async function editPhoneNumber(phoneNumberId: string, personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label') as string;
	const number = formData.get('number') as string;

	await phoneDb.editPhoneNumber(phoneNumberId, personId, {
		label,
		number,
	});

	redirect(`/people/${personId}`);
}

export async function addPhoneNumber(personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label') as string;
	const number = formData.get('number') as string;

	await phoneDb.addPhoneNumber(personId, {
		label,
		number,
	});

	redirect(`/people/${personId}`);
}

export async function deletePhoneNumber(phoneNumberId: string, personId: string) {
	'use server'

	await phoneDb.deletePhoneNumber(phoneNumberId);

	redirect(`/people/${personId}`);
}
