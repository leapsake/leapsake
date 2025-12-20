import { invoke } from '@tauri-apps/api/core';
import { Button, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { useReadContact } from '../_hooks';
import { getDisplayName } from '../_utils';

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
			<ScreenContainer>
				<ScreenHeader title="Delete Contact">
					<a href={`/contacts/${uuid}`}>Cancel</a>
				</ScreenHeader>
				<p>Loading...</p>
			</ScreenContainer>
		);
	}

	if (error || !contact) {
		// Redirect to browse page if contact not found
		window.location.href = '/';
		return null;
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
				title={`Delete ${displayName}`}
			>
				<a href={`/contacts/${uuid}`}>Cancel</a>
			</ScreenHeader>

			<div>
				<p>Are you sure you want to delete {displayName}?</p>
				<Button onClick={handleDelete}>Delete</Button>
			</div>
		</ScreenContainer>
	);
}
