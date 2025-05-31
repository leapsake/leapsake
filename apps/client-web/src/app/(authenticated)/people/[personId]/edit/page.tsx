import type { Metadata } from 'next'
import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/actions';
import { getPageTitle } from '@/utils';

type Props = {
	params: Promise<{ personId: string }>,
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: getPageTitle(`Edit ${person.given_name} ${person.family_name}`),
	};
}

export default async function EditPersonPage({ params }: Props) {
	const { personId } = await params;
	const person = await readPerson(personId);

	return (
		<Page
			actions={(
				<Actions>
					<Action
						href={`/people/${personId}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}`}</span>
					</Action>
				</Actions>
			)}
			title={`Edit ${person.given_name} ${person.family_name}`}
		>
			<PersonForm
				action={editPerson.bind(null, personId)}
				submitButtonContent="Save changes"
				person={person}
			/>
		</Page>
	);
}
