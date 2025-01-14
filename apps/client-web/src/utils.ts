export function getMilestoneLabelFromType(type: string) {
	return {
		'birth': 'Birthday',
		'wedding': 'Anniversary',
	}[type] || null;
}
