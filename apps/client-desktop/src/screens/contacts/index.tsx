import { PersonForm } from '../../components/PersonForm';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { join } from '@tauri-apps/api/path';
import { Contacts } from '../../components/Contacts';
import { ContactsList } from '../../components/ContactsList';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useData } from '../../hooks';
import { useState, useEffect } from 'preact/hooks';

function useBrowseContacts() {
	return useData(async () => {
		const appData = await appDataDir();
		const contactsPath = await join(appData, 'contacts');
		return invoke('browse_contacts', { path: contactsPath });
	});
}

export function AddContact() {
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

export function EditContact({ uuid }: { uuid: string }) {
	const [contact, setContact] = useState<any>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function fetchContact() {
			try {
				setIsLoading(true);
				const appData = await appDataDir();
				const contactsPath = await join(appData, 'contacts');
				const contactData = await invoke('read_contact', {
					path: contactsPath,
					uuid: uuid
				});
				setContact(contactData);
			} catch (err) {
				setError(String(err));
			} finally {
				setIsLoading(false);
			}
		}
		fetchContact();
	}, [uuid]);

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
			const filePath = await invoke('edit_contact', {
				path: contactsPath,
				uuid: uuid,
				data: contactData
			});
			console.log('Contact updated at:', filePath);
			// Redirect to the contact view page
			window.location.href = `/contacts/${uuid}`;
		} catch (error) {
			console.error('Failed to update contact:', error);
			alert('Failed to update contact: ' + error);
		}
	};

	if (isLoading) {
		return (
			<Contacts>
				<ScreenHeader title="Edit Contact">
					<a href={`/contacts/${uuid}`}>Cancel</a>
				</ScreenHeader>
				<p>Loading...</p>
			</Contacts>
		);
	}

	if (error || !contact) {
		return (
			<Contacts>
				<ScreenHeader title="Error">
					<a href="/">Go back</a>
				</ScreenHeader>
				<p>Error: {error || 'Contact not found'}</p>
			</Contacts>
		);
	}

	// Build display name
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.middle_name) nameParts.push(contact.middle_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact';

	return (
		<Contacts>
			<ScreenHeader
				title={`Edit ${displayName}`}
			>
				<a href={`/contacts/${uuid}`}>Cancel</a>
			</ScreenHeader>

			<PersonForm
				givenName={contact.given_name || ''}
				middleName={contact.middle_name || ''}
				familyName={contact.family_name || ''}
				birthday={contact.birthday || ''}
				anniversary={contact.anniversary || ''}
				onSubmit={handleSubmit}
			/>
		</Contacts>
	);
}

export function ReadContact({ uuid }: { uuid: string }) {
	const [contact, setContact] = useState<any>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function fetchContact() {
			try {
				setIsLoading(true);
				const appData = await appDataDir();
				const contactsPath = await join(appData, 'contacts');
				const contactData = await invoke('read_contact', {
					path: contactsPath,
					uuid: uuid
				});
				setContact(contactData);
			} catch (err) {
				setError(String(err));
			} finally {
				setIsLoading(false);
			}
		}
		fetchContact();
	}, [uuid]);

	if (isLoading) {
		return (
			<Contacts>
				<ScreenHeader title="View Contact">
					<a href="/">Go back</a>
				</ScreenHeader>
				<p>Loading...</p>
			</Contacts>
		);
	}

	if (error || !contact) {
		return (
			<Contacts>
				<ScreenHeader title="Error">
					<a href="/">Go back</a>
				</ScreenHeader>
				<p>Error: {error || 'Contact not found'}</p>
			</Contacts>
		);
	}

	// Build display name
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.middle_name) nameParts.push(contact.middle_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact';

	return (
		<Contacts>
			<ScreenHeader title={displayName}>
				<a href="/">Go back</a>
				{' | '}
				<a href={`/contacts/${uuid}/edit`}>Edit</a>
			</ScreenHeader>

			<div>
				<h2>Name</h2>
				{contact.given_name && <p><strong>First Name:</strong> {contact.given_name}</p>}
				{contact.middle_name && <p><strong>Middle Name:</strong> {contact.middle_name}</p>}
				{contact.family_name && <p><strong>Last Name:</strong> {contact.family_name}</p>}

				{(contact.birthday || contact.anniversary) && (
					<>
						<h2>Dates</h2>
						{contact.birthday && <p><strong>Birthday:</strong> {contact.birthday}</p>}
						{contact.anniversary && <p><strong>Anniversary:</strong> {contact.anniversary}</p>}
					</>
				)}

				<h2>Metadata</h2>
				<p><strong>UID:</strong> {contact.uid}</p>
				<p><strong>File:</strong> {contact.file_path}</p>
			</div>
		</Contacts>
	);
}

export function BrowseContacts() {
	const [data, isLoading] = useBrowseContacts();

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

