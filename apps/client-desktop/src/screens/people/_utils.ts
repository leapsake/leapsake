import type { ParsedContact } from '@/types';

export function getDisplayName(contact: ParsedContact, fallback = 'this contact') {
	const nameParts = [];
	if (contact.given_name) nameParts.push(contact.given_name);
	if (contact.family_name) nameParts.push(contact.family_name);
	const displayName = nameParts.length > 0 ? nameParts.join(' ') : fallback;

	return displayName;
}
