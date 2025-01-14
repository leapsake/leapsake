import { Fragment } from 'react';
import Link from 'next/link';
import { readPerson } from '@/db/people';

export default async function ReadPersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await readPerson(id);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<ul>
					<li><Link href={`/people/${id}/edit`}>📝 {`Edit ${person.given_name}`}</Link></li>
					<li><Link href={`/people/${id}/delete`}>🗑️ {`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<section>
				<h2>Milestones</h2>

				{!!person.birth_date
					? (
						<Fragment>
							<h3>🎂 Born</h3>
							<div>{person.birth_date}</div>
						</Fragment>
					)
					: (
						<Link href={`/people/${id}/milestones/edit?type=birth`}>➕ Add a Birthday</Link>
					)
				}
			</section>

			<footer>
				<i>Created: {person.created_at}<br/>Last Updated: {person.updated_at}</i>
			</footer>
		</Fragment>
	);
}
