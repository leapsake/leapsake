import PersonForm from '@/components/PersonForm';
import db from '@/db';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';

export default async function NewPersonPage() {
	async function createPerson(formData: FormData) {
		'use server'

		const givenName = formData.get('given_name');
		const familyName = formData.get('family_name');
		const id = uuidv4();

		db.run(`INSERT INTO People(id, given_name, family_name) VALUES(?, ?, ?)`, [
			id,
			givenName,
			familyName,
		], (err) => {
			if (err) {
				console.error(err);
			}
		});

		redirect(`/people/${id}`);
	}

	return (
		<Fragment>
			<h1>Add a Person</h1>

			<PersonForm
				action={createPerson}
				buttonText="Add"
			/>
		</Fragment>
	);
}
