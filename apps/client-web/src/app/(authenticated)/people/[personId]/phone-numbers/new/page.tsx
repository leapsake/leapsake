import Page from '@/components/Page';
import {
	addPhoneNumber,
	readPerson,
} from '@/actions';
import PhoneNumberForm from '@/components/PhoneNumberForm';

export default async function AddPhoneNumberPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addPhoneNumber.bind(null, personId);
	const title = `Add a Phone Number for ${person.given_name}`;

	return (
		<Page
			title={title}
		>
			<PhoneNumberForm
				action={action}
				submitButtonContent="Add Phone Number"
			/>
		</Page>
	);
}
