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

export function getContactData(formData: FormData) {
	return {
		given_name: formData.get('givenName') as string | null,
		middle_name: formData.get('middleName') as string | null,
		family_name: formData.get('familyName') as string | null,
		birthday: getPartialDate(formData, 'birthday'),
		anniversary: getPartialDate(formData, 'anniversary'),
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

	return '';
}
