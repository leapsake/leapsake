const defaultMilestones = [
	{
		label: 'Adoption',
		icon: '🧑‍🧑‍🧒',
		synonyms: [],
	}, {
		label: 'Anniversary',
		icon: '💒',
		synonyms: [],
	}, {
		label: 'Birthday',
		icon: '🎂',
		synonyms: [],
	}, {
		label: 'Engagement',
		icon: '💍',
		synonyms: [],
	}, {
		label: 'First Date',
		icon: '💕',
		synonyms: [],
	}, {
		label: 'Graduation',
		icon: '🎓',
		synonyms: [],
	}, {
		label: 'Moved',
		icon: '🏠',
		synonyms: [],
	}
];

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
	const defaultMilestone = defaultMilestones.find((milestone) => {
		return milestone.label === label;
	});

	if (defaultMilestone) {
		return defaultMilestone.icon;
	}

	return null;
}
