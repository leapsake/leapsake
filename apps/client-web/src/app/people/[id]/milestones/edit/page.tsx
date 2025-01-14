import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addMilestone, browseMilestones, editMilestone } from '@/db/milestones';
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
	let milestone = (await browseMilestones(personId)).find((milestone) => {
		return milestone.label === label;
	});

	let action, buttonText, title;
	if (!!milestone) {
		action = editMilestone.bind(null, milestone.id, personId);
		buttonText = 'Save Changes';
		title = `Edit ${person.given_name}'s ${label}`;
	} else {
		action = addMilestone.bind(null, personId);
		buttonText = 'Add Milestone';
		milestone = { label };
		title = getTitle(label, person.given_name);
	}

	return (
		<Fragment>
			<h1>{ title }</h1>

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
