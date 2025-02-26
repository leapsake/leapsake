import Form from '@/components/Form';
import Page from '@/components/Page';
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
		<Page
			title={`Delete ${phoneNumber.number} from ${person.given_name}?`}
		>
			<Form
				action={deletePhoneNumber.bind(null, phoneNumberId, personId)}
				submitButtonContent="Delete"
				submitButtonVariant="danger"
			/>
		</Page>
	);
}
