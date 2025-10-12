import { useEffect, useState } from 'preact/hooks';
import { PersonForm } from '../../components/PersonForm';
import { invoke } from '@tauri-apps/api/core';
import { Contacts } from '../../components/Contacts';

interface Contact {
	content: string;
	file_name: string;
	path: string;
};

interface ContactsListProps {
	contacts: Array<Contact>;
};

export function ContactsList({ contacts }: ContactsListProps) {
	return (
		<ol class={styles.list}>
			{contacts.map((contact) => (
				<li>
					<a href={contact.path}>
						{contact.file_name}
					</a>
				</li>
			))}
		</ol>
	);
}

function useContacts() {
	return useData(() => invoke('get_vcards'));
}

function useData(dataPromise) {
	const [data, setData] = useState(null);
	const [isLoading, setIsLoading] = useState(true);

	
	useEffect(() => {
		const getData = async () => {
			const data = await dataPromise();
			setData(data);
			setIsLoading(false);
		}
		
		getData();
	}, []);

	return [data, isLoading];
}

export function NewContact() {
	return (
		<Contacts contacts={[]}>
			<h1>New</h1>
			<a href="/">Go back</a>
			<PersonForm 
				onSubmit={(e) => {
					e.preventDefault();
					const formData = new FormData(e.currentTarget);
					console.log(formData);
				}}
			/>
		</Contacts>
	);
}

export function ViewContact() {
	const [, isLoading] = useContacts();

	if (isLoading) {
		return (
			<Contacts contacts={[]}>
				<h1>Loading</h1>
			</Contacts>
		);
	}

	return (
		<Contacts contacts={[]}>
			<h1></h1>
		</Contacts>
	);
}

export function BrowseContacts() {
	const [data, isLoading] = useContacts();

	if (isLoading) {
		return (
			<Contacts contacts={[]}>
				<h1>Loading</h1>
			</Contacts>
		);
	}

	return (
		<Contacts contacts={data}>
			<header>
				<h1>Browse</h1>
				<a href="/contacts/new">+ New</a>
			</header>
			<ContactsList contacts={data} />
		</Contacts>
	);
}

