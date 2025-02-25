import EmailAddressForm from '@/components/EmailAddressForm';
import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
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
		<Page
			actions={(
				<Actions>
					<Action
						href={`/people/${personId}/emails/${emailAddress.id}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}'s Email Address`}</span>
					</Action>
				</Actions>
			)}
			title={title}
		>
			<EmailAddressForm
				action={action}
				submitButtonContent="Save Changes"
				emailAddress={emailAddress}
			/>
		</Page>
	);
}
