import EmailAddressForm from '@/components/EmailAddressForm';
import { Fragment } from 'react';
import { readPerson } from '@/server';
import { addEmailAddress } from '@/db/emails';

export default async function AddEmailAddressPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addEmailAddress.bind(null, personId);
	const title = `Add an Email Address for ${person.given_name}`;

	return (
		<Fragment>
			<h1>{ title }</h1>

			<EmailAddressForm
				action={action}
				buttonText="Add Email Address"
			/>
		</Fragment>
	);
}
