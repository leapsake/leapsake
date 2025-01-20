import Link from 'next/link';
import PhoneNumberForm from '@/components/PhoneNumberForm';
import { Fragment } from 'react';
import { editPhoneNumber, readPhoneNumber } from '@/db/phone-numbers';
import { readPerson } from '@/db/people';

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
					<li><Link href={`/people/${personId}/phone-numbers/${phoneNumber.id}/delete`}>❌ {`Delete ${person.given_name}'s Phone Number`}</Link></li>
				</ul>
			</header>

			<PhoneNumberForm
				action={action}
				buttonText="Save Changes"
				phoneNumber={phoneNumber}
			/>
		</Fragment>
	);
}
