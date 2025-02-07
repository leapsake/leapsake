import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import {
	addMilestone,
	browseMilestones,
	readPerson,
} from '@/server';
import MilestoneForm from '@/components/MilestoneForm';

function getTitle(label, givenName) {
	if(!label) {
		return `Add a Milestone for ${givenName}`;
	} else {
		return `Add ${givenName}'s ${label}`;
	}
};

export default async function AddMilestonePage({ params, searchParams }) {
	const { personId } = await params;
	const label = (await searchParams).label;

	const person = await readPerson(personId);

	// Check to ensure milestone at existing label doesn't already exist.
	// If it does exist, go to edit page instead.
	const milestone = (await browseMilestones(personId)).find((milestone) => {
		return milestone.label === label;
	});

	if (!!milestone) {
		return redirect(`/people/${personId}/milestones/${milestone.id}/edit`);
	}

	const action = addMilestone.bind(null, personId);
	const buttonText = 'Add Milestone';
	const title = getTitle(label, person.given_name);

	return (
		<Fragment>
			<h1>{ title }</h1>

			<MilestoneForm
				action={action}
				buttonText={buttonText}
				label={label}
			/>
		</Fragment>
	);
}
