import {
	deletePhoneNumber,
	readPerson,
	readPhoneNumber,
} from '@/server';
import { Fragment } from 'react';

export default async function DeletePhoneNumberPage({ params }: { params: Promise<{ phoneNumberId: string }> }) {
	const { phoneNumberId, personId } = await params;
	const person = await readPerson(personId);
	const phoneNumber = await readPhoneNumber(phoneNumberId);

	return (
		<Fragment>
			<h1>{`Delete ${phoneNumber.number} from ${person.given_name}?`}</h1>

			<form action={deletePhoneNumber.bind(null, phoneNumberId, personId)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
