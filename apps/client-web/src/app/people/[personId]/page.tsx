import { Fragment } from 'react';
import Link from 'next/link';
import { readPerson } from '@/db/people';
import { browseMilestones } from '@/db/milestones';

export default async function ReadPersonPage({ params }: { params: Promise<{ personId: string }> }) {
	const { personId } = await params;
	const person = await readPerson(personId);
	const milestones = await browseMilestones(personId);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<ul>
					<li><Link href={`/people/${personId}/edit`}>📝 {`Edit ${person.given_name}`}</Link></li>
					<li><Link href={`/people/${personId}/delete`}>🗑️ {`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<section>
				<h2>Milestones</h2>

				{!!milestones.length
					? (
						<Fragment>
							<ul>
								{milestones.map((milestone) => {
									const isoDate = `${milestone.year}-${milestone.month}-${milestone.day}`;

									return (
										<li key={`${isoDate}-${milestone.label}`}>
											<b>{milestone.label}</b>
											<time datetime={isoDate}>{isoDate}</time>
											<Link href={`/people/${personId}/milestones/${milestone.id}/edit`}>📝 Edit</Link>
										</li>
									)
								})}
							</ul>
							<Link href={`/people/${personId}/milestones/new`}>➕ Add another Milestone</Link>
						</Fragment>
					)
					: (
						<Link href={`/people/${personId}/milestones/new?label=Birthday`}>➕ Add a Birthday</Link>
					)
				}
			</section>

			<footer>
				<i>Created: <time datetime={person.created_at}>{person.created_at}</time>
					<br/>Last Updated: <time datetime={person.updated_at}>{person.updated_at}</time></i>
			</footer>
		</Fragment>
	);
}
