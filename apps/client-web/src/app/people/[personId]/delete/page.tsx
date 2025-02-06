import { deletePerson, readPerson } from '@/server';
import { Fragment } from 'react';

export default async function DeletePersonPage({ params }: { params: Promise<{ personId: string }> }) {
	const { personId } = await params;
	const person = await readPerson(personId);

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name} ${person.family_name}?`}</h1>
			<form action={deletePerson.bind(null, personId)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
