import * as peopleDb from '@/db/people';
import { redirect } from 'next/navigation';

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
