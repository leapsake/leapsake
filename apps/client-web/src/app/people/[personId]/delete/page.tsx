import { Fragment } from 'react';
import type { Metadata } from 'next'
import { deletePerson, readPerson } from '@/server';
import { getPageTitle } from '@/utils';
import Form from '@/components/Form';

type Props = {
	params: Promise<{ personId: string }>
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: getPageTitle(`Delete ${person.given_name} ${person.family_name}`),
	};
}

export default async function DeletePersonPage({ params }: Props) {
	const { personId } = await params;
	const person = await readPerson(personId);

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name} ${person.family_name}?`}</h1>

			<Form
				action={deletePerson.bind(null, personId)}
				submitButtonContent="Delete"
			/>
		</Fragment>
	);
}
