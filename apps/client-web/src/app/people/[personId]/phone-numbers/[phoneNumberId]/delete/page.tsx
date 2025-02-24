import { Fragment } from 'react';
import Button from '@/components/Button';
import {
	deletePhoneNumber,
	readPerson,
	readPhoneNumber,
} from '@/server';

export default async function DeletePhoneNumberPage({ params }: { params: Promise<{ phoneNumberId: string }> }) {
	const { phoneNumberId, personId } = await params;
	const person = await readPerson(personId);
	const phoneNumber = await readPhoneNumber(phoneNumberId);

	return (
		<Fragment>
			<h1>{`Delete ${phoneNumber.number} from ${person.given_name}?`}</h1>

			<form action={deletePhoneNumber.bind(null, phoneNumberId, personId)}>
				<Button type="submit">Delete</Button>
			</form>
		</Fragment>
	);
}
