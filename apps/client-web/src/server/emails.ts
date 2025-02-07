import { redirect } from 'next/navigation';
import * as emailDb from '@/db/emails';

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
