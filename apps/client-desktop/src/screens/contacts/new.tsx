import { invoke } from '@tauri-apps/api/core';
import { getContactData } from '@/utils';
import { ContactForm, ScreenContainer, ScreenHeader } from '@leapsake/components';

export function AddContact() {
	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		const formData = new FormData(e.currentTarget as HTMLFormElement);

		const contactData = getContactData(formData);
		const format = formData.get('format') as string | null;

		try {
			const filePath = await invoke('add_contact', {
				data: contactData,
				format: format || undefined,
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
		<ScreenContainer>
			<ScreenHeader
				title="New"
			>
				<a href="/">Go back</a>
			</ScreenHeader>

			<ContactForm
				showFormatSelector={true}
				onSubmit={handleSubmit}
			/>
		</ScreenContainer>
	);
}
