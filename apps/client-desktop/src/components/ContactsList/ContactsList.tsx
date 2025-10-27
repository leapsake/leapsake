import { type Contact } from '../../types';
import styles from './ContactsList.module.css';

interface ContactsListProps {
	contacts: Contact[];
};

function extractUuidFromContact(contact: Contact): string | null {
	try {
		const data = JSON.parse(contact.content);
		const uid = data.uid as string;
		if (!uid) return null;

		// Extract UUID from "urn:uuid:..." format or use as-is if already just UUID
		const extracted = uid.replace('urn:uuid:', '');
		return extracted || null;
	} catch {
		return null;
	}
}

function extractNameFromContact(contact: Contact): string {
	try {
		const data = JSON.parse(contact.content);
		const name = data.name;

		if (!name) return contact.file_name;

		// Try "full" name format first
		if (name.full) {
			return name.full;
		}

		// Try structured components format
		const nameComponents = name.components || [];
		const given = nameComponents.find((c: any) => c.kind === 'given')?.value || '';
		const surname = nameComponents.find((c: any) => c.kind === 'surname')?.value || '';

		if (given && surname) {
			return `${given} ${surname}`;
		}
		if (given) return given;
		if (surname) return surname;

		// Fallback to filename
		return contact.file_name;
	} catch {
		return contact.file_name;
	}
}

export function ContactsList({ contacts }: ContactsListProps) {
	return (
		<ol class={styles.list}>
			{contacts.map((contact) => {
				const uuid = extractUuidFromContact(contact);
				const name = extractNameFromContact(contact);

				return (
					<li>
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
