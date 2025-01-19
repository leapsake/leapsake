import { readPerson } from '@/db/people';
import { deleteEmailAddress, readEmailAddress } from '@/db/emails';
import { Fragment } from 'react';

export default async function DeleteEmailAddressPage({ params }: { params: Promise<{ emailId: string }> }) {
	const { emailId, personId } = await params;
	const person = await readPerson(personId);
	const emailAddress = await readEmailAddress(emailId);

	return (
		<Fragment>
			<h1>{`Delete ${emailAddress.address} from ${person.given_name}?`}</h1>

			<form action={deleteEmailAddress.bind(null, emailId, personId)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
