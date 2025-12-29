// Import generated types from @leapsake/types
import type { JSContactData } from '@leapsake/types';

// Database types - convert optional fields to use null instead of undefined
// (Tauri serializes Rust Option::None as null, not undefined)
// Note: PartialDate supports both database format (no @type) and JSContact format (with @type)
export type PartialDate = {
	'@type'?: string;
	year?: number | null;
	month?: number | null;
	day?: number | null;
};

export type EmailAddress = {
	id: string;
	person_id: string;
	email: string;
	label?: string | null;
	position: number;
};

export type PhoneNumber = {
	id: string;
	person_id: string;
	number: string;
	label?: string | null;
	features?: string[] | null;
	position: number;
};

export type Address = {
	id: string;
	person_id: string;
	street: string;
	locality?: string | null;
	region?: string | null;
	postcode?: string | null;
	country?: string | null;
	label?: string | null;
	position: number;
};

export type Person = {
	id: string;
	given_name?: string | null;
	middle_name?: string | null;
	family_name?: string | null;
	birthday?: PartialDate | null;
	anniversary?: PartialDate | null;
	photo?: string | null;
	organization?: string | null;
	title?: string | null;
	url?: string | null;
	note?: string | null;
	created_at: number;
	updated_at: number;
};

export type NewPerson = {
	given_name?: string | null;
	middle_name?: string | null;
	family_name?: string | null;
	birthday?: PartialDate | null;
	anniversary?: PartialDate | null;
	photo?: string | null;
	organization?: string | null;
	title?: string | null;
	url?: string | null;
	note?: string | null;
};

export type PersonWithDetails = {
	person: Person;
	emails: EmailAddress[];
	phones: PhoneNumber[];
	addresses: Address[];
};

// Contact file types - use descriptive names
export type Contact = JSContactData; // Raw JSContact file data

// ParsedContact - a hybrid type for displaying both file-based contacts and database people
// This allows the UI components to work with both sources
export type ParsedContact = {
	uid: string;
	given_name?: string | null;
	middle_name?: string | null;
	family_name?: string | null;
	birthday?: PartialDate | null;
	anniversary?: PartialDate | null;
	emails?: Array<{ email: string; label?: string | null }> | null;
	phones?: Array<{ number: string; label?: string | null; features?: string[] | null }> | null;
	addresses?: Array<{
		street: string;
		locality?: string | null;
		region?: string | null;
		postcode?: string | null;
		country?: string | null;
		label?: string | null;
	}> | null;
	photo?: string | null;
	organization?: string | null;
	title?: string | null;
	url?: string | null;
	note?: string | null;
	file_path?: string;
};
