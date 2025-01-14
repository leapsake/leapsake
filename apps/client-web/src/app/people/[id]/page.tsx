import { Fragment } from 'react';
import Link from 'next/link';
import { readPerson } from '@/db/people';
import { browseMilestones } from '@/db/milestones';

export default async function ReadPersonPage({ params }: { params: Promise<{ id: string }> }) {
	const person_id = (await params).id;
	const person = await readPerson(person_id);
	const milestones = await browseMilestones(person_id);

	return (
		<Fragment>
			<header>
				<h1>{person.given_name} {person.family_name}</h1>
				<ul>
					<li><Link href={`/people/${person_id}/edit`}>📝 {`Edit ${person.given_name}`}</Link></li>
					<li><Link href={`/people/${person_id}/delete`}>🗑️ {`Delete ${person.given_name}`}</Link></li>
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
											<h3>{milestone.label}</h3>
											<time datetime={isoDate}>{isoDate}</time>
										</li>
									)
								})}
							</ul>
							<Link href={`/people/${person_id}/milestones/edit`}>➕ Add another Milestone</Link>
						</Fragment>
					)
					: (
						<Link href={`/people/${person_id}/milestones/edit?label=Birthday`}>➕ Add a Birthday</Link>
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
