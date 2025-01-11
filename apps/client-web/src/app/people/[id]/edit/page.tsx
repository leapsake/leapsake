import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/db/people';
import { Fragment } from 'react';
import Link from 'next/link';

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await readPerson(id);

	return (
		<Fragment>
			<header>
				<h1>{`Update ${person.given_name} ${person.family_name}`}</h1>

				<ul>
					<li><Link href={`/people/${id}/delete`}>{`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<PersonForm
				action={editPerson.bind(null, id)}
				buttonText="Update"
				person={person}
			/>
		</Fragment>
	);
}
