import { Fragment } from 'react';
import type { Metadata } from 'next'
import { deletePerson, readPerson } from '@/server';

type Props = {
	params: Promise<{ personId: string }>
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: `Delete ${person.given_name} ${person.family_name} | Leapsake`,
	};
}

export default async function DeletePersonPage({ params }: Props) {
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
