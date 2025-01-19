import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addEmailAddress } from '@/db/emails';
import BaseInput from '@/components/BaseInput';

export default async function AddEmailAddressPage({ params }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	const action = addEmailAddress.bind(null, personId);
	const title = `Add an Email Address for ${person.given_name}`;

	return (
		<Fragment>
			<h1>{ title }</h1>

			<form action={action}>
				<BaseInput
					label="Label"
					list="email-labels"
					name="label"
				/>

				<datalist id="email-labels">
					<option value="Personal"></option>
					<option value="Work"></option>
					<option value="School"></option>
				</datalist>

				<BaseInput
					label="Email Address"
					name="address"
				/>

				<button type="submit">Add Email Address</button>
			</form>
		</Fragment>
	);
}
