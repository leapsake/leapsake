import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
import {
	editPhoneNumber,
	readPerson,
	readPhoneNumber,
} from '@/server';
import PhoneNumberForm from '@/components/PhoneNumberForm';

export default async function EditPhoneNumberPage({ params }) {
	const { personId, phoneNumberId } = (await params);

	const person = await readPerson(personId);
	const phoneNumber = await readPhoneNumber(phoneNumberId);

	const action = editPhoneNumber.bind(null, phoneNumberId, personId);
	const title = `Edit ${person.given_name}'s Phone Number`;

	return (
		<Page
			actions={(
				<Actions>
					<Action
						href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}'s Phone Number`}</span>
					</Action>
				</Actions>
			)}
			title={title}
		>
			<PhoneNumberForm
				action={action}
				phoneNumber={phoneNumber}
				submitButtonContent="Save Changes"
			/>
		</Page>
	);
}
