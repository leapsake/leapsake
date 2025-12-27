import { ContactsList } from '@/components/ContactsList';
import { Button, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useBrowsePeople } from './_hooks';

export function BrowseContacts() {
	const [people, isLoading, error] = useBrowsePeople();

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
			<p>Error: {error || 'People not found'}</p>
		</ScreenContainer>
	}

	const noPeople = !(!!people && Array.isArray(people) && people.length > 0);

	// Convert Person to format ContactsList expects (similar to ParsedContact)
	const contacts = people?.map(person => ({
		uid: person.id,
		given_name: person.given_name,
		middle_name: person.middle_name,
		family_name: person.family_name,
		birthday: person.birthday,
		anniversary: person.anniversary,
		photo: person.photo,
		organization: person.organization,
		title: person.title,
		url: person.url,
		note: person.note,
	})) || [];

	return (
		<ScreenContainer>
			<ScreenHeader
				title="Contacts"
			>
				<Button href="/contacts/new">➕ New</Button>
			</ScreenHeader>
			{noPeople
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
