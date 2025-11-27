interface CountryInputProps {
	defaultValue: string;
}

export function CountryInput({
	defaultValue,
}: CountryInputProps) {
	return (
		<select defaultValue={defaultValue}>
			<option value="United States">🇺🇸 United States</option>
			<option disabled>-------</option>
			{COUNTRIES.map((country) => {
				return (
					<option
						value={country.name}
					>
						{`${country.flag} ${country.name}`}
					</option>
				);
			})}
		</select>
	);
}

const COUNTRIES = [
	{ name: 'Argentina', flag: '🇦🇷', },
	{ name: 'Australia', flag: '🇦🇺', },
	{ name: 'Brazil', flag: '🇧🇷', },
	{ name: 'Canada', flag: '🇨🇦', },
	{ name: 'China', flag: '🇨🇳', },
	{ name: 'France', flag: '🇫🇷', },
	{ name: 'Germany', flag: '🇩🇪', },
	{ name: 'India', flag: '🇮🇳', },
	{ name: 'Indonesia', flag: '🇮🇩', },
	{ name: 'Italy', flag: '🇮🇹', },
	{ name: 'Japan', flag: '🇯🇵', },
	{ name: 'Mexico', flag: '🇲🇽' },
	{ name: 'Russia', flag: '🇷🇺', },
	{ name: 'Saudi Arabia', flag: '🇸🇦', },
	{ name: 'South Africa', flag: '🇿🇦', },
	{ name: 'South Korea', flag: '🇰🇷', },
	{ name: 'Spain', flag: '🇪🇸', },
	{ name: 'Türkiye', flag: '🇹🇷', },
	{ name: 'Ukraine', flag: '🇺🇦', },
	{ name: 'United Kingdom', flag: '🇬🇧', },
	{ name: 'United States', flag: '🇺🇸', },
];
