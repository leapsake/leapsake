import { invoke } from '@tauri-apps/api/core';
import { getContactData } from '@/utils';
import { Button, ContactForm, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useReadPerson } from '../_hooks';
import { getDisplayName } from '../_utils';
import type { NewPerson } from '@/types';

export function EditPerson({ uuid }: { uuid: string }) {
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

		// Prepare emails as tuples: (email, label)
		const emails = (contactData.emails || []).map(e => [e.email, e.label || null] as [string, string | null]);

		// Prepare phones as tuples: (number, label, features)
		const phones = (contactData.phones || []).map(p => [
			p.number,
			p.label || null,
			p.features || null
		] as [string, string | null, string[] | null]);

		// Prepare addresses as tuples: (street, locality, region, postcode, country, label)
		const addresses = (contactData.addresses || []).map(a => [
			a.street,
			a.locality || null,
			a.region || null,
			a.postcode || null,
			a.country || null,
			a.label || null
		] as [string, string | null, string | null, string | null, string | null, string | null]);

		try {
			await invoke('db_update_person_with_details', {
				personId: uuid,
				person,
				emails,
				phones,
				addresses,
			});
			console.log('Person updated');
			// Redirect to the person view page
			window.location.href = `/people/${uuid}`;
		} catch (error) {
			console.error('Failed to update person:', error);
			alert('Failed to update person: ' + error);
		}
	};

	if (isLoading) {
		return (
			<ScreenContainer>
				<ScreenHeader title="Edit Person">
					<a href={`/people/${uuid}`}>Cancel</a>
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
						label: 'People',
						url: '/',
					},
					{
						label: displayName,
						url: `/people/${uuid}`,
					},
				]}
				title={`Edit ${displayName}`}
			>
				<div>
					<a href={`/people/${uuid}`}>Cancel</a>
					<Button href={`/people/${uuid}/delete`}>Delete</Button>
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
