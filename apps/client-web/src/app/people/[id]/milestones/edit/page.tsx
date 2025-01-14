import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addMilestone } from '@/db/milestones';
import MilestoneInput from '@/components/MilestoneInput';

function getTitle(type, person) {
	if (type === 'birth') {
		return `Add ${person.given_name}'s Birthday`;
	} else {
		return 'Add a Milestone';
	}
};

export default async function AddMilestonePage({ params, searchParams }) {
	const personId = (await params).id;
	const person = await readPerson(personId);
	const type = (await searchParams).type;

	const title = getTitle(type, person);

	return (
		<Fragment>
			<h1>{ title }</h1>

			<form action={addMilestone.bind(null, personId)} name="milestone">
				<input type="hidden" name="type" value={type} />

				<MilestoneInput
					label="Birthday"
					name="birth"
				/>

				<button type="submit">Add</button>
			</form>
		</Fragment>
	);
}
