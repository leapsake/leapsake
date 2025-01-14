import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { editMilestone, readMilestone } from '@/db/milestones';
import MilestoneForm from '@/components/MilestoneForm';

export default async function EditMilestonePage({ params }) {
	const { id: personId, milestoneId } = (await params);

	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	const action = editMilestone.bind(null, milestoneId, personId);
	const buttonText = 'Save Changes';
	const title = `Edit ${person.given_name}'s ${milestone.label}`;

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
