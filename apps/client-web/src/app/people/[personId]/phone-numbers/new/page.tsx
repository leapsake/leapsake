import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addPhoneNumber } from '@/db/phone-numbers';
import BaseInput from '@/components/BaseInput';

export default async function AddPhoneNumberPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addPhoneNumber.bind(null, personId);
	const title = `Add a PhoneNumber for ${person.given_name}`;

	return (
		<Fragment>
			<h1>{ title }</h1>

			<form action={action}>
				<BaseInput
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
					label="Phone Number"
					name="number"
				/>

				<button type="submit">Add Phone Number</button>
			</form>
		</Fragment>
	);
}
