import type { Metadata } from 'next'
import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
import {
	editMilestone,
	readMilestone,
	readPerson,
} from '@/actions';
import MilestoneForm from '@/components/MilestoneForm';
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
		title: getPageTitle(`Edit ${person.given_name}’s ${milestone.label}`),
	};
}

export default async function EditMilestonePage({ params }: Props) {
	const { personId, milestoneId } = (await params);

	const person = await readPerson(personId);
	const milestone = await readMilestone(milestoneId);

	const action = editMilestone.bind(null, milestoneId, personId);
	const submitButtonContent = 'Save Changes';
	const title = `Edit ${person.given_name}’s ${milestone.label}`;

	return (
		<Page
			actions={(
				<Actions>
					<Action
						href={`/people/${personId}/milestones/${milestone.id}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}'s ${milestone.label}`}</span>
					</Action>
				</Actions>
			)}
			title={title}
		>
			<MilestoneForm
				action={action}
				submitButtonContent={submitButtonContent}
				day={milestone.day}
				label={milestone.label}
				month={milestone.month}
				year={milestone.year}
			/>
		</Page>
	);
}
