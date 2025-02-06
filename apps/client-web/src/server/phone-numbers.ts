import { redirect } from 'next/navigation';
import * as phoneDb from '@/db/phone-numbers';

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
