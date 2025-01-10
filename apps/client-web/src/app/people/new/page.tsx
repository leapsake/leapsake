import PersonForm from '@/components/PersonForm';
import { addPerson } from '@/db/people';
import { Fragment } from 'react';

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
