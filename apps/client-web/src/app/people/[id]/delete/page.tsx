import { deletePerson, readPerson } from '@/db/people';
import { Fragment } from 'react';

export default async function DeletePersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await readPerson(id);

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name} ${person.family_name}?`}</h1>
			<form action={deletePerson.bind(null, id)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
