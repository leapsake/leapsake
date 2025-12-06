import { PartialDate } from './types';

function getPartialDate(formData: FormData, fieldName: string): PartialDate | null {
	const monthStr = formData.get(`${fieldName}-month}`) as string | null;
	const dayStr = formData.get(`${fieldName}-day}`) as string | null;
	const yearStr = formData.get(`${fieldName}-year}`) as string | null;

	// Parse to numbers, filtering out empty strings and invalid numbers
	const month = monthStr && monthStr.trim() ? parseInt(monthStr, 10) : undefined;
	const day = dayStr && dayStr.trim() ? parseInt(dayStr, 10) : undefined;
	const year = yearStr && yearStr.trim() ? parseInt(yearStr, 10) : undefined;

	// Only create a PartialDate if at least one field has a value
	if (month === undefined && day === undefined && year === undefined) {
		return null;
	}

	// Return PartialDate object per JSContact RFC 9553 section 2.8.1
	const partialDate: PartialDate = {
		'@type': 'PartialDate',
	};

	if (year !== undefined && !isNaN(year)) {
		partialDate.year = year;
	}

	if (month !== undefined && !isNaN(month)) {
		partialDate.month = month;
	}

	if (day !== undefined && !isNaN(day)) {
		partialDate.day = day;
	}

	return partialDate;
}

function getEmails(formData: FormData) {
	const emails = Array.from(formData.entries()).reduce((acc, [key, value]) => {
		// Only process email fields
		const match = key.match(/^emails\[(\d+)\]\.email$/);
		if (!match) return acc;

		const email = (value as string).trim();
		// Skip empty emails
		if (!email) return acc;

		const index = match[1];
		const label = formData.get(`emails[${index}].label`) as string | null;

		acc.push({
			email,
			label: label?.trim() || undefined,
		});

		return acc;
	}, [] as Array<{ email: string; label?: string }>);

	return emails.length > 0 ? emails : null;
}

function getPhones(formData: FormData) {
	const phones = Array.from(formData.entries()).reduce((acc, [key, value]) => {
		// Only process phone number fields
		const match = key.match(/^phones\[(\d+)\]\.number$/);
		if (!match) return acc;

		const number = (value as string).trim();
		// Skip empty phone numbers
		if (!number) return acc;

		const index = match[1];
		const label = formData.get(`phones[${index}].label`) as string | null;
		const canCall = formData.get(`phones[${index}].call`) === 'on';
		const canText = formData.get(`phones[${index}].text`) === 'on';

		// Build features array based on checkboxes
		const features = [];
		if (canCall) features.push('voice');
		if (canText) features.push('text');

		acc.push({
			number,
			label: label?.trim() || undefined,
			features: features.length > 0 ? features : undefined,
		});

		return acc;
	}, [] as Array<{ number: string; label?: string; features?: string[] }>);

	return phones.length > 0 ? phones : null;
}

function getAddresses(formData: FormData) {
	const addresses = Array.from(formData.entries()).reduce((acc, [key, value]) => {
		// Only process address street fields (we use street as the primary field)
		const match = key.match(/^addresses\[(\d+)\]\.street$/);
		if (!match) return acc;

		const street = (value as string).trim();
		// Skip addresses without a street
		if (!street) return acc;

		const index = match[1];
		const label = formData.get(`addresses[${index}].label`) as string | null;
		const locality = formData.get(`addresses[${index}].locality`) as string | null;
		const region = formData.get(`addresses[${index}].region`) as string | null;
		const postcode = formData.get(`addresses[${index}].postcode`) as string | null;
		const country = formData.get(`addresses[${index}].country`) as string | null;

		acc.push({
			street,
			locality: locality?.trim() || undefined,
			region: region?.trim() || undefined,
			postcode: postcode?.trim() || undefined,
			country: country?.trim() || undefined,
			label: label?.trim() || undefined,
		});

		return acc;
	}, [] as Array<{ street: string; locality?: string; region?: string; postcode?: string; country?: string; label?: string }>);

	return addresses.length > 0 ? addresses : null;
}

export function getContactData(formData: FormData) {
	return {
		given_name: formData.get('givenName') as string | null,
		middle_name: formData.get('middleName') as string | null,
		family_name: formData.get('familyName') as string | null,
		birthday: getPartialDate(formData, 'birthday'),
		anniversary: getPartialDate(formData, 'anniversary'),
		emails: getEmails(formData),
		phones: getPhones(formData),
		addresses: getAddresses(formData),
	};
}

const months = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

export function getDisplayDate(date: PartialDate): string {
	if (date.month === undefined && date.day !== undefined) {
		throw new Error('Invalid date provided');
	}

	if (date.month !== undefined && date.day !== undefined && date.year !== undefined) {
		return `${months[date.month - 1]} ${date.day}, ${date.year}`;
	}

	if (date.month !== undefined && date.year !== undefined) {
		return `${months[date.month - 1]} ${date.year}`;
	}
	
	if (date.month !== undefined && date.day !== undefined) {
		return `${months[date.month -1]} ${date.day}`;
	}

	if (date.year !== undefined) {
		return String(date.year);
	}

	if (date.month !== undefined) {
		return months[date.month - 1];
	}

	return '';
}
