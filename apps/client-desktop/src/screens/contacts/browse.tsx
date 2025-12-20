import { ContactsList } from '@/components/ContactsList';
import { Button, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useBrowseContacts } from './_hooks';

export function BrowseContacts() {
	const [contacts, isLoading, error] = useBrowseContacts();

	if (isLoading) {
		return (
			<ScreenContainer>
				<h1>Loading</h1>
			</ScreenContainer>
		);
	}

	if (error) {
		<ScreenContainer>
			<ScreenHeader title="Error">
				<a href="/">Go back</a>
			</ScreenHeader>
			<p>Error: {error || 'Contacts not found'}</p>
		</ScreenContainer>
	}

	const noContacts = !(!!contacts && Array.isArray(contacts) && contacts.length > 0);

	return (
		<ScreenContainer>
			<ScreenHeader
				title="Contacts"
			>
				<Button href="/contacts/new">➕ New</Button>
			</ScreenHeader>
			{noContacts
				? (
					<span>No contacts</span>
				)
				: (
					<ContactsList contacts={contacts} />
				)
			}
		</ScreenContainer>
	);
}
