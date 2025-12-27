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
