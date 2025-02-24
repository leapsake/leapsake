import type { Metadata } from 'next'
import { Fragment } from 'react';
import PersonForm from '@/components/PersonForm';
import { addPerson } from '@/server';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
  title: getPageTitle('Add a Person'),
}

export default async function NewPersonPage() {
	return (
		<Fragment>
			<h1>Add a Person</h1>

			<PersonForm
				action={addPerson}
				submitButtonContent="Add"
			/>
		</Fragment>
	);
}
