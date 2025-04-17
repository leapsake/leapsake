import type { Metadata } from 'next'
import Page from '@/components/Page';
import PersonForm from '@/components/PersonForm';
import { addPerson } from '@/actions';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
  title: getPageTitle('Add a Person'),
}

export default async function NewPersonPage() {
	return (
		<Page
			title="Add a Person"
		>
			<PersonForm
				action={addPerson}
				submitButtonContent="Add"
			/>
		</Page>
	);
}
