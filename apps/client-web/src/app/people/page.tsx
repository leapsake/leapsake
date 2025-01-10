import { Fragment } from 'react';
import Link from 'next/link';
import db from '@/db';

async function getPeople() {
	const people = await new Promise((resolve, reject) => {
		db.all(`SELECT * FROM People ORDER BY family_name ASC, given_name ASC`, (err, rows) => {
			if (err) {
				reject(err);
			} else {
				resolve(rows);
			}
		});
	});
	return people;
}

export default async function PeoplePage() {
	const people = await getPeople();

	return (
		<Fragment>
			<header>
				<h1>People</h1>
				<Link href="/people/new">Add a person</Link>
			</header>

			<ul>
				{people.map((person) => (
					<li key={person.id}>
						<Link href={`/people/${person.id}`}>{person.given_name} {person.family_name}</Link>
					</li>
				))}
			</ul>
		</Fragment>
	);
}
