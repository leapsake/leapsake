import db from '@/db';
import { Fragment } from 'react';
import { redirect } from 'next/navigation';

async function getPerson(id: string) {
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

	async function deletePerson(id) {
		'use server'

		db.run(`
			DELETE FROM People
			WHERE id = ?
		`, [
			id
		], (err) => {
			console.error(err);
		});

		redirect('/people');
	}

	return (
		<Fragment>
			<h1>{`Delete ${person.given_name} ${person.family_name}?`}</h1>
			<form action={deletePerson.bind(null, id)}>
				<button type="submit">Delete</button>
			</form>
		</Fragment>
	);
}
