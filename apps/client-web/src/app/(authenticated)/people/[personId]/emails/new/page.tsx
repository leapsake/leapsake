import EmailAddressForm from '@/components/EmailAddressForm';
import Page from '@/components/Page';
import { addEmailAddress, readPerson } from '@/actions';

export default async function AddEmailAddressPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addEmailAddress.bind(null, personId);
	const title = `Add an Email Address for ${person.given_name}`;

	return (
		<Page
			title={title}
		>
			<EmailAddressForm
				action={action}
				submitButtonContent="Add Email Address"
			/>
		</Page>
	);
}
