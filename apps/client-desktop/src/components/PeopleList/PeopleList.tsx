import { type ParsedContact } from '@/types';
import styles from './PeopleList.module.css';

interface PeopleListProps {
	people: ParsedContact[];
};

function extractUuidFromPerson(person: ParsedContact): string | null {
	const uid = person.uid;
	if (!uid) return null;

	// Extract UUID from "urn:uuid:..." format or use as-is if already just UUID
	const extracted = uid.replace('urn:uuid:', '');
	return extracted || null;
}

function getDisplayName(person: ParsedContact): string {
	const parts = [
		person.given_name,
		person.middle_name,
		person.family_name,
	].filter(Boolean);

	if (parts.length > 0) {
		return parts.join(' ');
	}

	// Fallback to filename if available, or "Unnamed Person"
	if (person.file_path) {
		const filename = person.file_path.split('/').pop() || '';
		return filename.replace(/\.(jscontact|vcf)$/, '') || 'Unnamed Person';
	}

	return 'Unnamed Person';
}

export function PeopleList({ people }: PeopleListProps) {
	return (
		<ol class={styles.list}>
			{people.map((person) => {
				const uuid = extractUuidFromPerson(person);
				const name = getDisplayName(person);

				return (
					<li key={uuid || person.file_path}>
						{uuid ? (
							<a href={`/people/${uuid}`}>
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
