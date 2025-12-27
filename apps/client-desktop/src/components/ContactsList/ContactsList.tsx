import { type ParsedContact } from '@/types';
import styles from './ContactsList.module.css';

interface ContactsListProps {
	contacts: ParsedContact[];
};

function extractUuidFromContact(contact: ParsedContact): string | null {
	const uid = contact.uid;
	if (!uid) return null;

	// Extract UUID from "urn:uuid:..." format or use as-is if already just UUID
	const extracted = uid.replace('urn:uuid:', '');
	return extracted || null;
}

function getDisplayName(contact: ParsedContact): string {
	const parts = [
		contact.given_name,
		contact.middle_name,
		contact.family_name,
	].filter(Boolean);

	if (parts.length > 0) {
		return parts.join(' ');
	}

	// Fallback to filename if available, or "Unnamed Contact"
	if (contact.file_path) {
		const filename = contact.file_path.split('/').pop() || '';
		return filename.replace(/\.(jscontact|vcf)$/, '') || 'Unnamed Contact';
	}

	return 'Unnamed Contact';
}

export function ContactsList({ contacts }: ContactsListProps) {
	return (
		<ol class={styles.list}>
			{contacts.map((contact) => {
				const uuid = extractUuidFromContact(contact);
				const name = getDisplayName(contact);

				return (
					<li key={uuid || contact.file_path}>
						{uuid ? (
							<a href={`/contacts/${uuid}`}>
								{name}
							</a>
						) : (
							<span>{name}</span>
						)}
					</li>
				);
			})}
		</ol>
	);
}
