import BaseInput from '@/components/BaseInput';
import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import Link from 'next/link';
import { editPhoneNumber, readPhoneNumber } from '@/db/phone-numbers';

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

			<form action={action}>
				<BaseInput
					defaultValue={phoneNumber.label}
					label="Label"
					list="number-labels"
					name="label"
				/>

				<datalist id="number-labels">
					<option value="Personal"></option>
					<option value="Work"></option>
					<option value="School"></option>
				</datalist>

				<BaseInput
					defaultValue={phoneNumber.number}
					label="Phone Number"
					name="number"
				/>

				<button type="submit">Save Changes</button>
			</form>
		</Fragment>
	);
}
