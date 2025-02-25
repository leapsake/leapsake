import { Fragment } from 'react';
import Button from '@/components/Button';
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
		<Fragment>
			<header>
				<h1>{ title }</h1>

				<ul>
					<li><Button href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}>❌ {`Delete ${person.given_name}'s Phone Number`}</Button></li>
				</ul>
			</header>

			<PhoneNumberForm
				action={action}
				phoneNumber={phoneNumber}
				submitButtonContent="Save Changes"
			/>
		</Fragment>
	);
}
