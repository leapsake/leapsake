import fs from 'fs/promises';
import path from 'path';
import { notFound, redirect } from 'next/navigation';

import * as emailDb from '@/db/emails';
import * as milestonesDb from '@/db/milestones';
import * as phoneDb from '@/db/phone-numbers';

const serverURL = process.env.SERVER_URL;

export async function browsePeople() {
	const response = await fetch(`${serverURL}/people`);
	const people = await response.json();	
	return people;
}

export async function readPerson(personId: string) {
	const response = await fetch (`${serverURL}/people/${personId}`);

	if (response.status === 404) {
		return notFound();
	}

	const person = await response.json();
	return person;
}

export async function editPerson(personId: string, formData: FormData) {
	'use server';

	const familyName = formData.get('family_name') as string;
	const givenName = formData.get('given_name') as string;
	const maidenName = formData.get('maiden_name') as string;
	const middleName = formData.get('middle_name') as string;

	await fetch(`${serverURL}/people/${personId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			familyName,
			givenName,
			maidenName,
			middleName,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function addPerson(formData: FormData) {
	'use server'

	const familyName = formData.get('family_name') as string;
	const givenName = formData.get('given_name') as string;
	const maidenName = formData.get('maiden_name') as string;
	const middleName = formData.get('middle_name') as string;

	const response = await fetch(`${serverURL}/people/`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			familyName,
			givenName,
			maidenName,
			middleName,
		}),
	});
	const personId = await response.json();

	redirect(`/people/${personId}`);
}

export async function deletePerson(personId: string) {
	'use server'

	await fetch(`${serverURL}/people/${personId}`, {
		method: 'DELETE',
	});

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
	const response = await fetch(`${serverURL}/photos`);
	const photos = await response.json();
	return photos;
}

export async function readPhoto(photoId: string) {
	const response = await fetch(`${serverURL}/photos/${photoId}`);

	if (response.status === 404) {
		return notFound();
	}

	const photo = await response.json();
	return photo;
}

export async function editPhoto(photoId: string, formData: FormData) {
	'use server'

	const description = formData.get('description') as string;

	await fetch(`${serverURL}/photos/${photoId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			description,
		}),
	});

	redirect(`/photos/${photoId}`);
}

export async function addPhotos(formData: FormData) {
	'use server'

	await fetch(`${serverURL}/photos`, {
		method: 'POST',
		body: formData,
	});

	redirect(`/photos`);
}

export async function deletePhoto(photoId: string) {
	'use server'

	await fetch(`${serverURL}/photos/${photoId}`, {
		method: 'DELETE',
	});

	redirect('/photos');
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
