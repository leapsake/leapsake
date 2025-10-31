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
	birthday?: string;
	anniversary?: string;
	file_path: string;
}

export interface PartialDate {
	'@type'?: string;
	year?: number;
	month?: number;
	day?: number;
}
