import { Fragment } from 'react';
import type { Metadata } from 'next'
import { Actions, Action } from '@/components/Actions';
import PersonForm from '@/components/PersonForm';
import { editPerson, readPerson } from '@/server';
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
		<Fragment>
			<header>
				<h1>{`Edit ${person.given_name} ${person.family_name}`}</h1>

				<Actions>
					<Action
						href={`/people/${personId}/delete`}
						variant="danger"
					>
						<span>❌ {`Delete ${person.given_name}`}</span>
					</Action>
				</Actions>
			</header>

			<PersonForm
				action={editPerson.bind(null, personId)}
				submitButtonContent="Update"
				person={person}
			/>
		</Fragment>
	);
}
