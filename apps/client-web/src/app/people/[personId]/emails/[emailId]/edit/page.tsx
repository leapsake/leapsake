import BaseInput from '@/components/BaseInput';
import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import Link from 'next/link';
import { editEmailAddress, readEmailAddress } from '@/db/emails';

export default async function EditEmailAddressPage({ params }) {
	const { personId, emailId } = (await params);

	const person = await readPerson(personId);
	const emailAddress = await readEmailAddress(emailId);

	const action = editEmailAddress.bind(null, emailId, personId);
	const title = `Edit ${person.given_name}'s Email Address`;

	return (
		<Fragment>
			<header>
				<h1>{ title }</h1>

				<ul>
					<li><Link href={`/people/${personId}/emails/${emailAddress.id}/delete`}>❌ {`Delete ${person.given_name}'s Email Address`}</Link></li>
				</ul>
			</header>

			<form action={action}>
				<BaseInput
					defaultValue={emailAddress.label}
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
					defaultValue={emailAddress.address}
					label="Email Address"
					name="address"
				/>

				<button type="submit">Save Changes</button>
			</form>
		</Fragment>
	);
}
