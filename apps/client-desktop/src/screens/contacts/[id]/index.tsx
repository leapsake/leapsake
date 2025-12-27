import { Button, ContactName, Details, ScreenContainer, ScreenHeader } from '@leapsake/components';
import { getDisplayDate } from '@/utils';
import { useReadPerson } from '../_hooks';
import { getDisplayName } from '../_utils';

export function ReadContact({ uuid }: { uuid: string }) {
	const [personWithDetails, isLoading, error] = useReadPerson({ personId: uuid });

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
					givenName={person.given_name}
					middleName={person.middle_name}
					familyName={person.family_name}
				/>

				{emails && emails.length > 0 && (
					<>
						<h2>Email Addresses</h2>
						{emails.map((emailData, index) => (
							<p key={index}>
								<strong>{emailData.label ? `${emailData.label}: ` : ''}</strong>
								<a href={`mailto:${emailData.email}`}>{emailData.email}</a>
							</p>
						))}
					</>
				)}

				{phones && phones.length > 0 && (
					<>
						<h2>Phone Numbers</h2>
						{phones.map((phoneData, index) => (
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

				{addresses && addresses.length > 0 && (
					<>
						<h2>Addresses</h2>
						{addresses.map((addressData, index) => (
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

				{(person.birthday || person.anniversary) && (
					<>
						<h2>Milestones</h2>
						{person.birthday && <p><strong>🎂 Birthday:</strong> {getDisplayDate(person.birthday)}</p>}
						{person.anniversary && <p><strong>💒 Anniversary:</strong> {getDisplayDate(person.anniversary)}</p>}
					</>
				)}

				{(person.organization || person.title || person.url || person.photo) && (
					<>
						<h2>Additional Information</h2>
						{person.organization && <p><strong>Organization:</strong> {person.organization}</p>}
						{person.title && <p><strong>Job Title:</strong> {person.title}</p>}
						{person.url && (
							<p>
								<strong>Website:</strong>{' '}
								<a href={person.url} target="_blank" rel="noopener noreferrer">
									{person.url}
								</a>
							</p>
						)}
						{person.photo && (
							<div>
								<strong>Photo:</strong>
								<br />
								<img
									src={person.photo}
									alt="Contact"
									style={{ maxWidth: '200px', maxHeight: '200px', marginTop: '8px' }}
									onError={(e) => {
										e.currentTarget.style.display = 'none';
										e.currentTarget.insertAdjacentHTML('afterend', '<p style="color: #666;">(Photo not available)</p>');
									}}
								/>
							</div>
						)}
					</>
				)}

				{person.note && (
					<>
						<h2>Notes</h2>
						<p style={{ whiteSpace: 'pre-wrap' }}>{person.note}</p>
					</>
				)}

				<Details
					summary="Metadata"
				>
					<div>
						<b>ID: </b>
						<span>{person.id}</span>
					</div>
					<div>
						<b>Created: </b>
						<span>{new Date(person.created_at).toLocaleString()}</span>
					</div>
					<div>
						<b>Updated: </b>
						<span>{new Date(person.updated_at).toLocaleString()}</span>
					</div>
				</Details>
			</div>
		</ScreenContainer>
	);
}
