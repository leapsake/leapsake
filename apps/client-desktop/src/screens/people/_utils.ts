import type { ParsedContact, Person } from '@/types';

export function getDisplayName(contact: ParsedContact | Person, fallback = 'this contact') {
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : fallback;

	return displayName;
}

// Helper to convert Person (database model) to ParsedContact (display format)
export function personToContact(person: Person): ParsedContact {
	return {
		uid: person.id,
		given_name: person.given_name,
		middle_name: person.middle_name,
		family_name: person.family_name,
		birthday: person.birthday,
		anniversary: person.anniversary,
		photo: person.photo,
		organization: person.organization,
		title: person.title,
		url: person.url,
		note: person.note,
	};
}
