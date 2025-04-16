import type { Metadata } from 'next'
import { redirect } from 'next/navigation';
import {
	addMilestone,
	browseMilestones,
	readPerson,
} from '@/actions';
import MilestoneForm from '@/components/MilestoneForm';
import Page from '@/components/Page';
import { getPageTitle } from '@/utils';

type Props = {
	params: Promise<{ personId: string }>,
	searchParams: Promise<{ label: string }>,
}

function getMilestonePageTitle(label: string, givenName: string) {
	if(!label) {
		return `Add a Milestone for ${givenName}`;
	} else {
		return `Add ${givenName}’s ${label}`;
	}
};

export async function generateMetadata({
	params,
	searchParams,
}: Props): Promise<Metadata> {
	const { personId } = await params;
	const { label } = await searchParams;
	const person = await readPerson(personId);
	const milestonePageTitle = getMilestonePageTitle(label, person.given_name);

	return {
		title: getPageTitle(milestonePageTitle),
	};
}

export default async function AddMilestonePage({ params, searchParams }: Props) {
	const { personId } = await params;
	const { label } = await searchParams;

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
	const submitButtonContent = 'Add Milestone';
	const title = getMilestonePageTitle(label, person.given_name);

	return (
		<Page
			title={title}
		>
			<MilestoneForm
				action={action}
				submitButtonContent={submitButtonContent}
				label={label}
			/>
		</Page>
	);
}
