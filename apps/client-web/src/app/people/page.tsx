import { Fragment } from 'react';
import Link from 'next/link';
import { browsePeople } from '@/db/people';

export default async function PeoplePage() {
	const people = await browsePeople();

	return (
		<Fragment>
			<header>
				<h1>People</h1>

				<ul>
					<li><Link href="/people/new">➕ Add a person</Link></li>
				</ul>
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
