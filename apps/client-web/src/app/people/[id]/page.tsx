import { Fragment } from 'react';
import Link from 'next/link';
import db from '@/db';

async function getPerson(id) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM people WHERE id = ?`, [ id ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await getPerson(id);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<Link href={`/people/${id}/edit`}>{`Edit ${person.given_name}`}</Link>
				<Link href={`/people/${id}/delete`}>{`Delete ${person.given_name}`}</Link>
			</header>

			<section>
				<h2>Born</h2>
				<div>{person.birth_date}</div>
			</section>
		</Fragment>
	);
}
