import { invoke } from '@tauri-apps/api/core';
import { getContactData } from '@/utils';
import { Button, ContactForm, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useReadContact } from '../_hooks';
import { getDisplayName } from '../_utils';

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
			<ScreenContainer>
				<ScreenHeader title="Edit Contact">
					<a href={`/contacts/${uuid}`}>Cancel</a>
				</ScreenHeader>
				<p>Loading...</p>
			</ScreenContainer>
		);
	}

	if (error || !contact) {
		return (
			<ScreenContainer>
				<ScreenHeader title="Error">
					<a href="/">Go back</a>
				</ScreenHeader>
				<p>Error: {error || 'Contact not found'}</p>
			</ScreenContainer>
		);
	}

	const displayName = getDisplayName(contact);

	return (
		<ScreenContainer>
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
					<Button href={`/contacts/${uuid}/delete`}>Delete</Button>
				</div>
			</ScreenHeader>

			<ContactForm
				givenName={contact.given_name || ''}
				middleName={contact.middle_name || ''}
				familyName={contact.family_name || ''}
				birthday={contact.birthday}
				anniversary={contact.anniversary}
				emails={contact.emails || []}
				phones={contact.phones || []}
				addresses={contact.addresses || []}
				photo={contact.photo || ''}
				organization={contact.organization || ''}
				title={contact.title || ''}
				url={contact.url || ''}
				note={contact.note || ''}
				onSubmit={handleSubmit}
			/>
		</ScreenContainer>
	);
}
