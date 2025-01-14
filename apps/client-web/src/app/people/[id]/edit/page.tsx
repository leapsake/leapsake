import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/db/people';
import { Fragment } from 'react';
import Link from 'next/link';

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
	const person_id = (await params).id;
	const person = await readPerson(person_id);

	return (
		<Fragment>
			<header>
				<h1>{`Edit ${person.given_name} ${person.family_name}`}</h1>

				<ul>
					<li><Link href={`/people/${person_id}/delete`}>🗑️ {`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<PersonForm
				action={editPerson.bind(null, person_id)}
				buttonText="Update"
				person={person}
			/>
		</Fragment>
	);
}
