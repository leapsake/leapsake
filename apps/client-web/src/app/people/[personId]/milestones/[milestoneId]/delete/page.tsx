import { readPerson } from '@/db/people';
import { deleteMilestone, readMilestone } from '@/db/milestones';
import { Fragment } from 'react';

export default async function DeleteMilestonePage({ params }: { params: Promise<{ milestoneId: string }> }) {
	const { milestoneId, personId } = await params;
	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name}'s ${milestone.label}?`}</h1>

			<form action={deleteMilestone.bind(null, milestoneId, personId)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
