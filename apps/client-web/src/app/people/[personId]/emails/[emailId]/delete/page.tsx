import { Fragment } from 'react';
import {
	deleteEmailAddress,
	readEmailAddress,
	readPerson,
} from '@/server';

export default async function DeleteEmailAddressPage({ params }: { params: Promise<{ emailId: string }> }) {
	const { emailId, personId } = await params;
	const person = await readPerson(personId);
	const emailAddress = await readEmailAddress(emailId);

	return (
		<Fragment>
			<h1>{`Delete ${emailAddress.address} from ${person.given_name}?`}</h1>

			<form action={deleteEmailAddress.bind(null, emailId, personId)}>
				<Button type="submit">Delete</Button>
			</form>
		</Fragment>
	);
}
