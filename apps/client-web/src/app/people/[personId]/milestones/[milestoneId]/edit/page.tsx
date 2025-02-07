import { Fragment } from 'react';
import Link from 'next/link';
import {
	editMilestone,
	readMilestone,
	readPerson,
} from '@/server';
import MilestoneForm from '@/components/MilestoneForm';

export default async function EditMilestonePage({ params }) {
	const { personId, milestoneId } = (await params);

	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	const action = editMilestone.bind(null, milestoneId, personId);
	const buttonText = 'Save Changes';
	const title = `Edit ${person.given_name}'s ${milestone.label}`;

	return (
		<Fragment>
			<header>
				<h1>{ title }</h1>

				<ul>
					<li><Link href={`/people/${personId}/milestones/${milestone.id}/delete`}>❌ {`Delete ${person.given_name}'s ${milestone.label}`}</Link></li>
				</ul>
			</header>

			<MilestoneForm
				action={action}
				buttonText={buttonText}
				day={milestone.day}
				label={milestone.label}
				month={milestone.month}
				year={milestone.year}
			/>
		</Fragment>
	);
}
