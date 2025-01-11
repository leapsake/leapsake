import { Fragment } from 'react';
import Link from 'next/link';
import { readPerson } from '@/db/people';

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await readPerson(id);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<ul>
					<li><Link href={`/people/${id}/edit`}>{`Edit ${person.given_name}`}</Link></li>
					<li><Link href={`/people/${id}/delete`}>{`Delete ${person.given_name}`}</Link></li>
				</ul>
				<div>Created: {person.created_at}, Last Updated: {person.updated_at}</div>
			</header>

			<section>
				<h2>Born</h2>
				<div>{person.birth_date}</div>
			</section>
		</Fragment>
	);
}
