import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addMilestone } from '@/db/milestones';
import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';

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

			<form action={addMilestone.bind(null, personId)} name="milestone">
				{!label
					? (
						<BaseInput
							label="Label"
							name="label"
							type="text"
						/>
					)
					: (
						<input type="hidden" name="label" value={label} />
					)
				}

				<DateInput />

				<button type="submit">Add</button>
			</form>
		</Fragment>
	);
}
