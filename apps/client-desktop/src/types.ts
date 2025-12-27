export interface Contact {
	content: string;
	file_name: string;
	path: string;
}

export interface ParsedContact {
	uid: string;
	given_name?: string;
	middle_name?: string;
	family_name?: string;
	birthday?: PartialDate;
	anniversary?: PartialDate;
	emails?: Array<{ email: string; label?: string }>;
	phones?: Array<{ number: string; label?: string; features?: string[] }>;
	addresses?: Array<{ street: string; locality?: string; region?: string; postcode?: string; country?: string; label?: string }>;
	photo?: string;
	organization?: string;
	title?: string;
	url?: string;
	note?: string;
	file_path: string;
}

export interface PartialDate {
	'@type'?: string;
	year?: number;
	month?: number;
	day?: number;
}

// Database types (new SQLite-backed API)

export interface Person {
	id: string;
	given_name?: string;
	middle_name?: string;
	family_name?: string;
	birthday?: PartialDate;
	anniversary?: PartialDate;
	photo?: string;
	organization?: string;
	title?: string;
	url?: string;
	note?: string;
	created_at: number;
	updated_at: number;
}

export interface EmailAddress {
	id: string;
	person_id: string;
	email: string;
	label?: string;
	position: number;
}

export interface PhoneNumber {
	id: string;
	person_id: string;
	number: string;
	label?: string;
	features?: string[];
	position: number;
}

export interface Address {
	id: string;
	person_id: string;
	street: string;
	locality?: string;
	region?: string;
	postcode?: string;
	country?: string;
	label?: string;
	position: number;
}

export interface PersonWithDetails {
	person: Person;
	emails: EmailAddress[];
	phones: PhoneNumber[];
	addresses: Address[];
}

export interface NewPerson {
	given_name?: string;
	middle_name?: string;
	family_name?: string;
	birthday?: PartialDate;
	anniversary?: PartialDate;
	photo?: string;
	organization?: string;
	title?: string;
	url?: string;
	note?: string;
}
