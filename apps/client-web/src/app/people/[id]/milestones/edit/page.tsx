import { Fragment } from 'react';
import { readPerson } from '@/db/people';
import { addMilestone } from '@/db/milestones';
import { getMilestoneLabelFromType } from '@/utils';
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
	const type = (await searchParams).type;

	const person = await readPerson(personId);
	const label = getMilestoneLabelFromType(type);

	const title = getTitle(label, person.given_name);

	return (
		<Fragment>
			<h1>{ title }</h1>

			<form action={addMilestone.bind(null, personId)} name="milestone">
				<input type="hidden" name="type" value={type} />

				{!label
					? (
						<BaseInput
							label="Label"
							name="label"
							type="text"
						/>
					)
					: null
				}

				<DateInput
					name={type}
				/>

				<button type="submit">Add</button>
			</form>
		</Fragment>
	);
}
