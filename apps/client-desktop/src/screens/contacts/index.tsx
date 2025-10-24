import { PersonForm } from '../../components/PersonForm';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { join } from '@tauri-apps/api/path';
import { Contacts } from '../../components/Contacts';
import { ContactsList } from '../../components/ContactsList';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useData } from '../../hooks';

function useContacts() {
	return useData(async () => {
		const appData = await appDataDir();
		const contactsPath = await join(appData, 'contacts');
		return invoke('get_contacts', { path: contactsPath });
	});
}

export function NewContact() {
	return (
		<Contacts>
			<ScreenHeader
				title="New"
			>
				<a href="/">Go back</a>
			</ScreenHeader>

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
			<Contacts>
				<h1>Loading</h1>
			</Contacts>
		);
	}

	return (
		<Contacts>
			<h1></h1>
		</Contacts>
	);
}

export function BrowseContacts() {
	const [data, isLoading] = useContacts();

	if (isLoading) {
		return (
			<Contacts>
				<h1>Loading</h1>
			</Contacts>
		);
	}

	const noContacts = !(!!data && Array.isArray(data) && data.length > 0);

	return (
		<Contacts>
			<ScreenHeader
				title="Browse"
			>
				<a href="/contacts/new">+ New</a>
			</ScreenHeader>
			{noContacts
				? (
					<span>No contacts</span>
				)
				: (
					<ContactsList contacts={data} />
				)
			}
		</Contacts>
	);
}

