import { Fragment } from 'react';
import EmailAddressForm from '@/components/EmailAddressForm';
import Button from '@/components/Button';
import {
	editEmailAddress,
	readEmailAddress,
	readPerson
} from '@/server';

export default async function EditEmailAddressPage({ params }) {
	const { personId, emailId } = (await params);

	const person = await readPerson(personId);
	const emailAddress = await readEmailAddress(emailId);

	const action = editEmailAddress.bind(null, emailId, personId);
	const title = `Edit ${person.given_name}'s Email Address`;

	return (
		<Fragment>
			<header>
				<h1>{ title }</h1>

				<ul>
					<li><Button href={`/people/${personId}/emails/${emailAddress.id}/delete`}>❌ {`Delete ${person.given_name}'s Email Address`}</Button></li>
				</ul>
			</header>

			<EmailAddressForm
				action={action}
				submitButtonContent="Save Changes"
				emailAddress={emailAddress}
			/>
		</Fragment>
	);
}
