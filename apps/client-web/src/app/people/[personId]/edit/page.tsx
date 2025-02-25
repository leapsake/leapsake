import { Fragment } from 'react';
import type { Metadata } from 'next'
import Link from 'next/link';
import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/server';
import { getPageTitle } from '@/utils';

type Props = {
	params: Promise<{ personId: string }>,
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: getPageTitle(`Edit ${person.given_name} ${person.family_name}`),
	};
}

export default async function EditPersonPage({ params }: Props) {
	const { personId } = await params;
	const person = await readPerson(personId);

	return (
		<Fragment>
			<header>
				<h1>{`Edit ${person.given_name} ${person.family_name}`}</h1>

				<ul>
					<li><Link href={`/people/${personId}/delete`}>❌ {`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<PersonForm
				action={editPerson.bind(null, personId)}
				submitButtonContent="Update"
				person={person}
			/>
		</Fragment>
	);
}
