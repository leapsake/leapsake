import { Fragment } from 'react';
import EmailAddressForm from '@/components/EmailAddressForm';
import { Actions, Action } from '@/components/Actions';
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

				<Actions>
					<Action
						href={`/people/${personId}/emails/${emailAddress.id}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}'s Email Address`}</span>
					</Action>
				</Actions>
			</header>

			<EmailAddressForm
				action={action}
				submitButtonContent="Save Changes"
				emailAddress={emailAddress}
			/>
		</Fragment>
	);
}
