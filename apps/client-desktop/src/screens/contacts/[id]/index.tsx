import { Button, ContactName, Details, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { getDisplayDate } from '@/utils';
import { useReadContact } from '../_hooks';
import { getDisplayName } from '../_utils';

export function ReadContact({ uuid }: { uuid: string }) {
	const [contact, isLoading, error] = useReadContact({ uuid });

	if (isLoading) {
		return (
			<ScreenContainer>
				<ScreenHeader title="View Contact">
					<a href="/">Go back</a>
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
				]}
				title={displayName}
			>
				<div>
					<Button href={`/contacts/${uuid}/edit`}>Edit</Button>
					<Button href={`/contacts/${uuid}/delete`}>Delete</Button>
				</div>
			</ScreenHeader>

			<div>
				<ContactName
					title={<h2>Name</h2>}
					givenName={contact.given_name}
					middleName={contact.middle_name}
					familyName={contact.family_name}
				/>

				{contact.emails && contact.emails.length > 0 && (
					<>
						<h2>Email Addresses</h2>
						{contact.emails.map((emailData, index) => (
							<p key={index}>
								<strong>{emailData.label ? `${emailData.label}: ` : ''}</strong>
								<a href={`mailto:${emailData.email}`}>{emailData.email}</a>
							</p>
						))}
					</>
				)}

				{contact.phones && contact.phones.length > 0 && (
					<>
						<h2>Phone Numbers</h2>
						{contact.phones.map((phoneData, index) => (
							<p key={index}>
								<strong>{phoneData.label ? `${phoneData.label}: ` : ''}</strong>
								<a href={`tel:${phoneData.number}`}>{phoneData.number}</a>
								{phoneData.features && phoneData.features.length > 0 && (
									<span> ({phoneData.features.join(', ')})</span>
								)}
							</p>
						))}
					</>
				)}

				{contact.addresses && contact.addresses.length > 0 && (
					<>
						<h2>Addresses</h2>
						{contact.addresses.map((addressData, index) => (
							<div key={index}>
								{addressData.label && <strong>{addressData.label}:</strong>}
								<p>
									{addressData.street}
									{addressData.locality && <><br/>{addressData.locality}</>}
									{(addressData.region || addressData.postcode) && (
										<>
											<span>, </span>
											{addressData.region && `${addressData.region} `}
											{addressData.postcode}
										</>
									)}
									{addressData.country && <><br/>{addressData.country}</>}
								</p>
							</div>
						))}
					</>
				)}

				{(contact.birthday || contact.anniversary) && (
					<>
						<h2>Milestones</h2>
						{contact.birthday && <p><strong>🎂 Birthday:</strong> {getDisplayDate(contact.birthday)}</p>}
						{contact.anniversary && <p><strong>💒 Anniversary:</strong> {getDisplayDate(contact.anniversary)}</p>}
					</>
				)}

				<Details
					summary={<h2>Metadata</h2>}
				>
					<div>
						<b>UUID: </b>
						<span>{contact.uid}</span>
					</div>
					<div>
						<b>File: </b>
						<span>{contact.file_path}</span>
					</div>
				</Details>
			</div>
		</ScreenContainer>
	);
}
