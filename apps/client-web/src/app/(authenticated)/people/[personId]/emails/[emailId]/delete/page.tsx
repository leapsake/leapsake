import Form from '@/components/Form';
import Page from '@/components/Page';
import {
	deleteEmailAddress,
	readEmailAddress,
	readPerson,
} from '@/actions';

export default async function DeleteEmailAddressPage({ params }: { params: Promise<{ emailId: string, personId: string }> }) {
	const { emailId, personId } = await params;
	const person = await readPerson(personId);
	const emailAddress = await readEmailAddress(emailId);

	return (
		<Page
			title={`Delete ${emailAddress.address} from ${person.given_name}?`}
		>
			<Form
				action={deleteEmailAddress.bind(null, emailId, personId)}
				submitButtonContent="Delete"
				submitButtonVariant="danger"
			/>
		</Page>
	);
}
