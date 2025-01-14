export function getPrettyDate(day, month, year) {
	const monthLabel = [
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
		'December'
	][Number(month) - 1];

	const dayLabel = Number(day);

	if (monthLabel && dayLabel && year) {
		return `${monthLabel} ${dayLabel}, ${year}`;
	} else if (monthLabel && dayLabel) {
		return `${monthLabel} ${dayLabel}`;
	} else if (monthLabel && year) {
		return `${monthLabel} ${year}`;
	} else {
		return monthLabel || year;
	}
}

export function getMilestoneIcon(label) {
	return {
		Adoption: '🧑‍🧑‍🧒',
		Anniversary: '💒',
		Birthday: '🎂',
		Engagement: '💍',
		'First Date': '💕',
		Graduation: '🎓',
		Moved: '🏠',
	}[label];
}
