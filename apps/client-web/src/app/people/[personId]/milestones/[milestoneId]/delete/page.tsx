import { Fragment } from 'react';
import type { Metadata } from 'next'
import Button from '@/components/Button';
import {
	deleteMilestone,
	readMilestone,
	readPerson,
} from '@/server';
import { getPageTitle } from '@/utils';

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
		title: getPageTitle(`Delete ${person.given_name}’s ${milestone.label}`),
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
				<Button type="submit">Delete</Button>
			</form>
		</Fragment>
	);
}
