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
	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		// Get the contacts path
		const appData = await appDataDir();
		const contactsPath = await join(appData, 'contacts');

		// Prepare contact data matching NewContactData structure in Rust
		const contactData = {
			given_name: formData.get('givenName') as string | null,
			middle_name: formData.get('middleName') as string | null,
			family_name: formData.get('familyName') as string | null,
			birthday: formData.get('birthday') as string | null,
			anniversary: formData.get('anniversary') as string | null,
		};

		try {
			const filePath = await invoke('add_contact', {
				path: contactsPath,
				data: contactData
			});
			console.log('Contact created at:', filePath);
			// Redirect to contacts list
			window.location.href = '/';
		} catch (error) {
			console.error('Failed to create contact:', error);
			alert('Failed to create contact: ' + error);
		}
	};

	return (
		<Contacts>
			<ScreenHeader
				title="New"
			>
				<a href="/">Go back</a>
			</ScreenHeader>

			<PersonForm
				onSubmit={handleSubmit}
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

