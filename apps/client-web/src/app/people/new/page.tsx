import PersonForm from '@/components/PersonForm';
import type { Metadata } from 'next'
import { addPerson } from '@/server';
import { Fragment } from 'react';

export const metadata: Metadata = {
  title: 'Add a Person | Leapsake',
}

export default async function NewPersonPage() {
	return (
		<Fragment>
			<h1>Add a Person</h1>

			<PersonForm
				action={addPerson}
				buttonText="Add"
			/>
		</Fragment>
	);
}
