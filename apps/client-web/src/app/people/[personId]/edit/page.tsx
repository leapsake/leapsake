import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/server';
import { Fragment } from 'react';
import Link from 'next/link';

export default async function EditPersonPage({ params }: { params: Promise<{ personId: string }> }) {
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
				buttonText="Update"
				person={person}
			/>
		</Fragment>
	);
}
