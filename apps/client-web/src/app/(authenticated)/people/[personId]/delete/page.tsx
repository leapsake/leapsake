import type { Metadata } from 'next'
import { deletePerson, readPerson } from '@/actions';
import { getPageTitle } from '@/utils';
import Form from '@/components/Form';
import Page from '@/components/Page';

type Props = {
	params: Promise<{ personId: string }>
}

export async function generateMetadata(
	{ params }: Props
): Promise<Metadata> {
	const { personId } = await params;
	const person = await readPerson(personId);

	return {
		title: getPageTitle(`Delete ${person.given_name} ${person.family_name}`),
	};
}

export default async function DeletePersonPage({ params }: Props) {
	const { personId } = await params;
	const person = await readPerson(personId);

	return (
		<Page
			title={`Delete ${person.given_name} ${person.family_name}?`}
		>
			<Form
				action={deletePerson.bind(null, personId)}
				submitButtonContent="Delete"
				submitButtonVariant="danger"
			/>
		</Page>
	);
}
