import TextInput from '@/components/TextInput';
import DateInput from '@/components/DateInput';
import db from '@/db';
import { Fragment } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

async function getPerson(id) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM people WHERE id = ?`, [ id ], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
	return person;
}

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
	const id = (await params).id;
	const person = await getPerson(id);

	async function editPerson(formData: FormData) {
		'use server'

		const givenName = formData.get('given_name');
		const familyName = formData.get('family_name');
		const birthDate = formData.get('birth_date');

		db.run(`
			UPDATE people
			SET given_name = ?, family_name = ?, birth_date = ?
			WHERE id = ?
		`, [
			givenName,
			familyName,
			birthDate,
			id
		], (err) => {
			console.error(err);
		});

		redirect(`/people/${id}`);
	}

	return (
		<Fragment>
			<header>
				<h1>{`Update ${person.given_name} ${person.family_name}`}</h1>
				<Link href={`/people/${id}/delete`}>{`Delete ${person.given_name}`}</Link>
			</header>
			<form action={editPerson}>
				<TextInput
					defaultValue={person.given_name}
					label="First Name"
					name="given_name"
				/>

				<TextInput
					defaultValue={person.family_name}
					label="Last Name"
					name="family_name"
				/>

				<DateInput
					defaultValue={person.birth_date}
					label="Birthday"
					name="birth_date"
				/>

				<button type="submit">Submit</button>
			</form>
		</Fragment>
	);
}
