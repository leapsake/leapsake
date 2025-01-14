import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addMilestone } from '@/db/milestones';
import MilestoneForm from '@/components/MilestoneForm';

function getTitle(label, givenName) {
	if(!label) {
		return `Add a Milestone for ${givenName}`;
	} else {
		return `Add ${givenName}'s ${label}`;
	}
};

export default async function AddMilestonePage({ params, searchParams }) {
	const personId = (await params).id;
	const label = (await searchParams).label;

	const person = await readPerson(personId);

	const title = getTitle(label, person.given_name);

	return (
		<Fragment>
			<h1>{ title }</h1>

			<MilestoneForm
				action={addMilestone.bind(null, personId)}
				buttonText="Add Milestone"
				label={label}
			/>
		</Fragment>
	);
}
