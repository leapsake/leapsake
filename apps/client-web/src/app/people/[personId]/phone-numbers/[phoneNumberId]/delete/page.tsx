import { Fragment } from 'react';
import Form from '@/components/Form';
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

			<Form
				action={deletePhoneNumber.bind(null, phoneNumberId, personId)}
				submitButtonContent="Delete"
			/>
		</Fragment>
	);
}
