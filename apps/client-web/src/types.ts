export interface EmailAddress {
	address: string;
	label: string;
};

export interface Milestone {
	day: string;
	label: string;
	month: string;
	year: string;
};

export interface Person {
	familyName: string;
	givenName: string;
	maidenName: string;
	middleName: string;
};

export interface PhoneNumber {
	label: string;
	number: string;
}

export interface Photo {
	id: string;
	path: string;
}
