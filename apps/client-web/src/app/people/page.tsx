import { Fragment } from 'react';
import type { Metadata } from 'next'
import Link from '@/components/Link';
import { browsePeople } from '@/server';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
	title: getPageTitle('People'),
}

export default async function BrowsePeoplePage() {
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
