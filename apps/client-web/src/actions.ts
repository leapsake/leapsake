import fs from 'fs/promises';
import path from 'path';
import { notFound, redirect } from 'next/navigation';

import * as milestonesDb from '@/db/milestones';

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

	const response = await fetch(`${serverURL}/people`, {
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
	const params = new URLSearchParams();
	params.append('personId', personId);
	const response = await fetch(`${serverURL}/email-addresses?${params}`);
	const emailAddresses = await response.json();	
	return emailAddresses;
}

export async function readEmailAddress(emailAddressId: string) {
	const response = await fetch (`${serverURL}/email-addresses/${emailAddressId}`);

	if (response.status === 404) {
		return notFound();
	}

	const emailAddress = await response.json();
	return emailAddress;
}

export async function editEmailAddress(emailAddressId: string, personId: string, formData: FormData) {
	'use server'

	const address = formData.get('address') as string;
	const label = formData.get('label') as string;

	await fetch(`${serverURL}/email-addresses/${emailAddressId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			address,
			label,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function addEmailAddress(personId: string, formData: FormData) {
	'use server'

	const address = formData.get('address') as string;
	const label = formData.get('label') as string;

	await fetch(`${serverURL}/email-addresses`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			address,
			label,
			personId,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function deleteEmailAddress(emailAddressId: string, personId: string) {
	'use server'

	await fetch(`${serverURL}/email-addresses/${emailAddressId}`, {
		method: 'DELETE',
	});

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
	const params = new URLSearchParams();
	params.append('personId', personId);
	const url = `${serverURL}/phone-numbers?${params}`;
	const response = await fetch(url);
	const phoneNumbers = await response.json();	
	return phoneNumbers;
}

export async function readPhoneNumber(phoneNumberId: string) {
	const response = await fetch (`${serverURL}/phone-numbers/${phoneNumberId}`);

	if (response.status === 404) {
		return notFound();
	}

	const phoneNumber = await response.json();
	return phoneNumber;
}

export async function editPhoneNumber(phoneNumberId: string, personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label') as string;
	const number = formData.get('number') as string;

	await fetch(`${serverURL}/phone-numbers/${phoneNumberId}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			label,
			number,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function addPhoneNumber(personId: string, formData: FormData) {
	'use server'

	const label = formData.get('label') as string;
	const number = formData.get('number') as string;

	await fetch(`${serverURL}/phone-numbers`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			label,
			number,
			personId,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function deletePhoneNumber(phoneNumberId: string, personId: string) {
	'use server'

	await fetch(`${serverURL}/phone-numbers/${phoneNumberId}`, {
		method: 'DELETE',
	});

	redirect(`/people/${personId}`);
}
