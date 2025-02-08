import { Fragment } from 'react';
import type { Metadata } from 'next'
import {
	deleteMilestone,
	readMilestone,
	readPerson,
} from '@/server';

type Props = {
	params: Promise<{
		personId: string,
		milestoneId: string,
	}>,
}

export async function generateMetadata({
	params,
}: Props): Promise<Metadata> {
	const { personId, milestoneId } = await params;
	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	return {
		title: `Delete ${person.given_name}’s ${milestone.label} | Leapsake`,
	};
}

export default async function DeleteMilestonePage({ params }: Props) {
	const { milestoneId, personId } = await params;
	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name}’s ${milestone.label}?`}</h1>

			<form action={deleteMilestone.bind(null, milestoneId, personId)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
