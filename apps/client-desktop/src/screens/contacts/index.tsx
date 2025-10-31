import { invoke } from '@tauri-apps/api/core';
import { ContactName } from '@/components/ContactName';
import { Contacts } from '@/components/Contacts';
import { ContactsList } from '@/components/ContactsList';
import { PersonForm } from '@/components/PersonForm';
import { ScreenHeader } from '@/components/ScreenHeader';
import { getContactData, getDisplayDate } from '@/utils';
import { useData } from '@/hooks';

function useBrowseContacts() {
	return useData(async () => {
		return invoke('browse_contacts');
	});
}

function useReadContact({ uuid }: { uuid: string }) {
	return useData(async () => {
		return invoke('read_contact', {
			uuid,
		});
	}, [ uuid ]);
}

function getDisplayName(contact, fallback = 'this contact') {
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : fallback;

	return displayName;
}

export function AddContact() {
	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactData = getContactData(formData);

		try {
			const filePath = await invoke('add_contact', {
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
	const [contact, isLoading, error]  = useReadContact({ uuid });

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactData = getContactData(formData);

		try {
			const filePath = await invoke('edit_contact', {
				uuid,
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

	const displayName = getDisplayName(contact);

	return (
		<Contacts>
			<ScreenHeader
				breadcrumbs={[
					{
						label: 'Contacts',
						url: '/',
					},
					{
						label: displayName,
						url: `/contacts/${uuid}`,
					},
				]}
				title={`Edit ${displayName}`}
			>
				<div>
					<a href={`/contacts/${uuid}`}>Cancel</a>
					{' | '}
					<a href={`/contacts/${uuid}/delete`}>Delete</a>
				</div>
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
	const [contact, isLoading, error] = useReadContact({ uuid });

	const handleDelete = async () => {
		try {
			await invoke('delete_contact', {
				uuid,
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

	const displayName = getDisplayName(contact);

	return (
		<Contacts>
			<ScreenHeader
				breadcrumbs={[
					{
						label: 'Contacts',
						url: '/',
					},
					{
						label: displayName,
						url: `/contacts/${uuid}`,
					},
				]}
				title={`Delete ${displayName}`}
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
	const [contact, isLoading, error] = useReadContact({ uuid });

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

	const displayName = getDisplayName(contact);

	return (
		<Contacts>
			<ScreenHeader 
				breadcrumbs={[
					{
						label: 'Contacts',
						url: '/',
					},
				]}
				title={displayName}
			>
				<div>
					<a href={`/contacts/${uuid}/edit`}>Edit</a>
					{' | '}
					<a href={`/contacts/${uuid}/delete`}>Delete</a>
				</div>
			</ScreenHeader>

			<div>
				<ContactName
					title={<h2>Name</h2>}
					givenName={contact.given_name}
					middleName={contact.middle_name}
					familyName={contact.family_name}
				/>

				{(contact.birthday || contact.anniversary) && (
					<>
						<h2>Dates</h2>
						{contact.birthday && <p><strong>🎂 Birthday:</strong> {getDisplayDate(contact.birthday)}</p>}
						{contact.anniversary && <p><strong>💒 Anniversary:</strong> {getDisplayDate(contact.anniversary)}</p>}
					</>
				)}

				<details>
					<summary><h2>Metadata</h2></summary>
					<div>
						<p><strong>UID:</strong> {contact.uid}</p>
						<p><strong>File:</strong> {contact.file_path}</p>
					</div>
				</details>
			</div>
		</Contacts>
	);
}

export function BrowseContacts() {
	const [contacts, isLoading, error] = useBrowseContacts();

	if (isLoading) {
		return (
			<Contacts>
				<h1>Loading</h1>
			</Contacts>
		);
	}

	if (error) {
		<Contacts>
			<ScreenHeader title="Error">
				<a href="/">Go back</a>
			</ScreenHeader>
			<p>Error: {error || 'Contacts not found'}</p>
		</Contacts>
	}

	const noContacts = !(!!contacts && Array.isArray(contacts) && contacts.length > 0);

	return (
		<Contacts>
			<ScreenHeader
				title="Contacts"
			>
				<a href="/contacts/new">➕ New</a>
			</ScreenHeader>
			{noContacts
				? (
					<span>No contacts</span>
				)
				: (
					<ContactsList contacts={contacts} />
				)
			}
		</Contacts>
	);
}

