import { PersonForm } from '../../components/PersonForm';
import { invoke } from '@tauri-apps/api/core';
import { Contacts } from '../../components/Contacts';
import { ContactsList } from '../../components/ContactsList';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useData } from '../../hooks';
import { useState, useEffect } from 'preact/hooks';
import { getContactData, getContactsPath } from '../../utils';

interface PartialDate {
	'@type'?: string;
	year?: number;
	month?: number;
	day?: number;
}

function formatPartialDate(date: PartialDate): string {
	const parts: string[] = [];

	if (date.month !== undefined) {
		parts.push(String(date.month));
	}

	if (date.day !== undefined) {
		parts.push(String(date.day));
	}

	if (date.year !== undefined) {
		parts.push(String(date.year));
	}

	return parts.length > 0 ? parts.join('/') : '';
}

function useBrowseContacts() {
	return useData(async () => {
		const contactsPath = await getContactsPath();
		return invoke('browse_contacts', { path: contactsPath });
	});
}

export function AddContact() {
	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactsPath = await getContactsPath();
		const contactData = getContactData(formData);

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
				const contactsPath = await getContactsPath();
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

		const contactsPath = await getContactsPath();
		const contactData = getContactData(formData);

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
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact';

	return (
		<Contacts>
			<ScreenHeader
				title={`Edit ${displayName}`}
			>
				<a href={`/contacts/${uuid}`}>Cancel</a>
				{' | '}
				<a href={`/contacts/${uuid}/delete`}>Delete</a>
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

export function DeleteContact({ uuid }: { uuid: string }) {
	const [contact, setContact] = useState<any>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function fetchContact() {
			try {
				setIsLoading(true);
				const contactsPath = await getContactsPath();
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

	const handleDelete = async () => {
		try {
			const contactsPath = await getContactsPath();
			await invoke('delete_contact', {
				path: contactsPath,
				uuid: uuid
			});
			console.log('Contact deleted');
			// Redirect to browse page
			window.location.href = '/';
		} catch (error) {
			console.error('Failed to delete contact:', error);
			// Stay on page if deletion fails
		}
	};

	if (isLoading) {
		return (
			<Contacts>
				<ScreenHeader title="Delete Contact">
					<a href={`/contacts/${uuid}`}>Cancel</a>
				</ScreenHeader>
				<p>Loading...</p>
			</Contacts>
		);
	}

	if (error || !contact) {
		// Redirect to browse page if contact not found
		window.location.href = '/';
		return null;
	}

	// Build display name
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'this contact';

	return (
		<Contacts>
			<ScreenHeader
				title="Delete Contact"
			>
				<a href={`/contacts/${uuid}`}>Cancel</a>
			</ScreenHeader>

			<div>
				<p>Are you sure you want to delete {displayName}?</p>
				<button onClick={handleDelete}>Delete</button>
			</div>
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
				const contactsPath = await getContactsPath();
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
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact';

	return (
		<Contacts>
			<ScreenHeader title={displayName}>
				<a href="/">Go back</a>
				{' | '}
				<a href={`/contacts/${uuid}/edit`}>Edit</a>
				{' | '}
				<a href={`/contacts/${uuid}/delete`}>Delete</a>
			</ScreenHeader>

			<div>
				<h2>Name</h2>
				{contact.given_name && <p><strong>First Name:</strong> {contact.given_name}</p>}
				{contact.middle_name && <p><strong>Middle Name:</strong> {contact.middle_name}</p>}
				{contact.family_name && <p><strong>Last Name:</strong> {contact.family_name}</p>}

				{(contact.birthday || contact.anniversary) && (
					<>
						<h2>Dates</h2>
						{contact.birthday && <p><strong>Birthday:</strong> {formatPartialDate(contact.birthday)}</p>}
						{contact.anniversary && <p><strong>Anniversary:</strong> {formatPartialDate(contact.anniversary)}</p>}
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

