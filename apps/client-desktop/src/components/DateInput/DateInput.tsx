import { TextInput } from '../TextInput';
import { PartialDate } from '../../types';
import styles from './DateInput.module.css';

interface DateInputProps {
	defaultValue?: PartialDate;
	label: string;
	name: string;
}

function parsePartialDate(partialDate?: PartialDate): { month: string; day: string; year: string } {
	if (!partialDate) {
		return { month: '', day: '', year: '' };
	}

	return {
		month: partialDate.month !== undefined ? String(partialDate.month) : '',
		day: partialDate.day !== undefined ? String(partialDate.day) : '',
		year: partialDate.year !== undefined ? String(partialDate.year) : '',
	};
}

export function DateInput({
	defaultValue,
	label,
	name,
	...rest
}: DateInputProps) {
	const { month, day, year } = parsePartialDate(defaultValue);

	return (
		<fieldset
			{...rest}
			class={styles.fieldset}
			name={name}
		>
			<legend>{label}</legend>

			<TextInput
				defaultValue={month}
				inputMode="numeric"
				label="Month"
				name={`${name}-month}`}
				pattern="[0-9]{1,2}"
			/>

			<TextInput
				defaultValue={day}
				inputMode="numeric"
				label="Day"
				name={`${name}-day}`}
				pattern="[0-9]{1,2}"
			/>

			<TextInput
				defaultValue={year}
				inputMode="numeric"
				label="Year"
				name={`${name}-year}`}
				pattern="[0-9]{4}"
			/>
		</fieldset>
	);
}
