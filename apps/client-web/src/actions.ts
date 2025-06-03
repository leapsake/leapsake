import { notFound, redirect } from 'next/navigation';

const serverURL = process.env.SERVER_URL;

export async function browsePeople() {
	const url = `${serverURL}/people`;

	const response = await fetch(url);
	const people = await response.json();	

	return people;
}

export async function readPerson(personId: string) {
	const url = `${serverURL}/people/${personId}`;

	const response = await fetch (url);

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

	const url = `${serverURL}/people/${personId}`;

	await fetch(url, {
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

	const url = `${serverURL}/people`;

	const response = await fetch(url, {
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

	const url = `${serverURL}/people/${personId}`;

	await fetch(url, {
		method: 'DELETE',
	});

	redirect('/people');
}

export async function browseEmailAddresses(personId: string) {
	const params = new URLSearchParams();
	params.append('personId', personId);

	const url = `${serverURL}/email-addresses?${params}`;
	const response = await fetch(url);
	const emailAddresses = await response.json();	

	return emailAddresses;
}

export async function readEmailAddress(emailAddressId: string) {
	const url = `${serverURL}/email-addresses/${emailAddressId}`;
	const response = await fetch (url);

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

	const url = `${serverURL}/email-addresses/${emailAddressId}`;

	await fetch(url, {
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

	const url = `${serverURL}/email-addresses`;

	await fetch(url, {
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

	const url = `${serverURL}/email-addresses/${emailAddressId}`;

	await fetch(url, {
		method: 'DELETE',
	});

	redirect(`/people/${personId}`);
}

export async function browsePhotos() {
	const url = `${serverURL}/photos`;
	const response = await fetch(url);
	const photos = await response.json();
	return photos;
}

export async function readPhoto(photoId: string) {
	const url = `${serverURL}/photos/${photoId}`;
	const response = await fetch(url);

	if (response.status === 404) {
		return notFound();
	}

	const photo = await response.json();
	return photo;
}

export async function editPhoto(photoId: string, formData: FormData) {
	'use server'

	const description = formData.get('description') as string;

	const url = `${serverURL}/photos/${photoId}`;

	await fetch(url, {
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

	const url = `${serverURL}/photos`;

	await fetch(url, {
		method: 'POST',
		body: formData,
	});

	redirect(`/photos`);
}

export async function deletePhoto(photoId: string) {
	'use server'

	const url = `${serverURL}/photos/${photoId}`;

	await fetch(url, {
		method: 'DELETE',
	});

	redirect('/photos');
}

export async function browseMilestones(personId: string) {
	const params = new URLSearchParams();
	params.append('personId', personId);

	const url = `${serverURL}/milestones?${params}`;
	const response = await fetch(url);
	const milestones = await response.json();	

	return milestones;
}

export async function readMilestone(milestoneId: string) {
	const url = `${serverURL}/milestones/${milestoneId}`;
	const response = await fetch (url);

	if (response.status === 404) {
		return notFound();
	}

	const milestone = await response.json();
	return milestone;
}

export async function editMilestone(milestoneId: string, personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	const url = `${serverURL}/milestones/${milestoneId}`;

	await fetch(url, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			day,
			label,
			month,
			year,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function addMilestone(personId: string, formData: FormData) {
	'use server'

	const day = formData.get('day') as string;
	const label = formData.get('label') as string;
	const month = formData.get('month') as string;
	const year = formData.get('year') as string;

	const url = `${serverURL}/milestones`;

	await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			day,
			label,
			month,
			year,
			personId,
		}),
	});

	redirect(`/people/${personId}`);
}

export async function deleteMilestone(milestoneId: string, personId: string) {
	'use server'

	const url = `${serverURL}/milestones/${milestoneId}`;

	await fetch(url, {
		method: 'DELETE',
	});

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
	const url = `${serverURL}/phone-numbers/${phoneNumberId}`;
	const response = await fetch (url);

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

	const url = `${serverURL}/phone-numbers/${phoneNumberId}`;

	await fetch(url, {
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

	const url = `${serverURL}/phone-numbers`;

	await fetch(url, {
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

	const url = `${serverURL}/phone-numbers/${phoneNumberId}`;

	await fetch(url, {
		method: 'DELETE',
	});

	redirect(`/people/${personId}`);
}
