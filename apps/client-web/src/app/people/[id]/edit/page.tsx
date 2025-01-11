import PersonForm from '@/components/PersonForm';
import db from '@/db';
import { Fragment } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

async function getPerson(id) {
	const person = await new Promise((resolve, reject) => {
		db.get(`SELECT * FROM People WHERE id = ?`, [ id ], (err, row) => {
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

		db.run(`
			UPDATE People
			SET updated_at = datetime('now'), given_name = ?, family_name = ?
			WHERE id = ?
		`, [
			givenName,
			familyName,
			id
		], (err) => {
			if (err) {
				console.error(err);
			}
		});

		redirect(`/people/${id}`);
	}

	return (
		<Fragment>
			<header>
				<h1>{`Update ${person.given_name} ${person.family_name}`}</h1>

				<ul>
					<li><Link href={`/people/${id}/delete`}>{`Delete ${person.given_name}`}</Link></li>
				</ul>
			</header>

			<PersonForm
				action={editPerson}
				buttonText="Update"
				person={person}
			/>
		</Fragment>
	);
}
