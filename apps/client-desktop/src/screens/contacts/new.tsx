import { invoke } from '@tauri-apps/api/core';
import { getContactData } from '@/utils';
import { ContactForm, ScreenContainer, ScreenHeader } from '@leapsake/components';
import type { NewPerson } from '@/types';

export function AddContact() {
	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactData = getContactData(formData);

		// Prepare person data
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
			const personId = await invoke<string>('db_create_person', {
				person,
				emails,
				phones,
				addresses,
			});
			console.log('Person created with ID:', personId);
			// Redirect to contacts list
			window.location.href = '/';
		} catch (error) {
			console.error('Failed to create person:', error);
			alert('Failed to create person: ' + error);
		}
	};

	return (
		<ScreenContainer>
			<ScreenHeader
				title="New"
			>
				<a href="/">Go back</a>
			</ScreenHeader>

			<ContactForm
				showFormatSelector={false}
				onSubmit={handleSubmit}
			/>
		</ScreenContainer>
	);
}
