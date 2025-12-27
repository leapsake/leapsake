import { invoke } from '@tauri-apps/api/core';
import { getContactData } from '@/utils';
import { Button, ContactForm, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useReadPerson } from '../_hooks';
import { getDisplayName } from '../_utils';
import type { NewPerson } from '@/types';

export function EditContact({ uuid }: { uuid: string }) {
	const [personWithDetails, isLoading, error]  = useReadPerson({ personId: uuid });

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactData = getContactData(formData);

		// Prepare person data for update
		const person: NewPerson = {
			given_name: contactData.given_name || undefined,
			middle_name: contactData.middle_name || undefined,
			family_name: contactData.family_name || undefined,
			birthday: contactData.birthday || undefined,
			anniversary: contactData.anniversary || undefined,
			photo: contactData.photo || undefined,
			organization: contactData.organization || undefined,
			title: contactData.title || undefined,
			url: contactData.url || undefined,
			note: contactData.note || undefined,
		};

		try {
			// Update person core fields
			await invoke('db_update_person', {
				personId: uuid,
				person,
			});

			// Delete all existing emails and add new ones
			if (personWithDetails?.emails) {
				for (const email of personWithDetails.emails) {
					await invoke('db_delete_email', { emailId: email.id });
				}
			}
			if (contactData.emails) {
				for (const emailData of contactData.emails) {
					await invoke('db_add_email', {
						personId: uuid,
						email: emailData.email,
						label: emailData.label || null,
					});
				}
			}

			// Delete all existing phones and add new ones
			if (personWithDetails?.phones) {
				for (const phone of personWithDetails.phones) {
					await invoke('db_delete_phone', { phoneId: phone.id });
				}
			}
			if (contactData.phones) {
				for (const phoneData of contactData.phones) {
					await invoke('db_add_phone', {
						personId: uuid,
						number: phoneData.number,
						label: phoneData.label || null,
						features: phoneData.features || null,
					});
				}
			}

			// Delete all existing addresses and add new ones
			if (personWithDetails?.addresses) {
				for (const address of personWithDetails.addresses) {
					await invoke('db_delete_address', { addressId: address.id });
				}
			}
			if (contactData.addresses) {
				for (const addressData of contactData.addresses) {
					await invoke('db_add_address', {
						personId: uuid,
						street: addressData.street,
						locality: addressData.locality || null,
						region: addressData.region || null,
						postcode: addressData.postcode || null,
						country: addressData.country || null,
						label: addressData.label || null,
					});
				}
			}

			console.log('Person updated');
			// Redirect to the contact view page
			window.location.href = `/contacts/${uuid}`;
		} catch (error) {
			console.error('Failed to update person:', error);
			alert('Failed to update person: ' + error);
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

	if (error || !personWithDetails) {
		return (
			<ScreenContainer>
				<ScreenHeader title="Error">
					<a href="/">Go back</a>
				</ScreenHeader>
				<p>Error: {error || 'Person not found'}</p>
			</ScreenContainer>
		);
	}

	const { person, emails, phones, addresses } = personWithDetails;
	const displayName = getDisplayName(person);

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
				givenName={person.given_name || ''}
				middleName={person.middle_name || ''}
				familyName={person.family_name || ''}
				birthday={person.birthday}
				anniversary={person.anniversary}
				emails={emails.map(e => ({ email: e.email, label: e.label }))}
				phones={phones.map(p => ({ number: p.number, label: p.label, features: p.features }))}
				addresses={addresses.map(a => ({
					street: a.street,
					locality: a.locality,
					region: a.region,
					postcode: a.postcode,
					country: a.country,
					label: a.label
				}))}
				photo={person.photo || ''}
				organization={person.organization || ''}
				title={person.title || ''}
				url={person.url || ''}
				note={person.note || ''}
				onSubmit={handleSubmit}
			/>
		</ScreenContainer>
	);
}
