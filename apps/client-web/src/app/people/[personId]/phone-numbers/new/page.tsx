import PhoneNumberForm from '@/components/PhoneNumberForm';
import { Fragment } from 'react';
import { addPhoneNumber } from '@/db/phone-numbers';
import { readPerson } from '@/db/people';

export default async function AddPhoneNumberPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addPhoneNumber.bind(null, personId);
	const title = `Add a Phone Number for ${person.given_name}`;

	return (
		<Fragment>
			<h1>{ title }</h1>

			<PhoneNumberForm
				action={action}
				buttonText="Add Phone Number"
			/>
		</Fragment>
	);
}
