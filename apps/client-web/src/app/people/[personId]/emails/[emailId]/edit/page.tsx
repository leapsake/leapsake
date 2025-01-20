import EmailAddressForm from '@/components/EmailAddressForm';
import Link from 'next/link';
import { Fragment } from 'react';
import { editEmailAddress, readEmailAddress } from '@/db/emails';
import { readPerson } from '@/db/people';

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
					<li><Link href={`/people/${personId}/emails/${emailAddress.id}/delete`}>❌ {`Delete ${person.given_name}'s Email Address`}</Link></li>
				</ul>
			</header>

			<EmailAddressForm
				action={action}
				buttonText="Save Changes"
				emailAddress={emailAddress}
			/>
		</Fragment>
	);
}
