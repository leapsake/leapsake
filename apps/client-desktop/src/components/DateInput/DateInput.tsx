import { TextInput } from "../TextInput";
import styles from './DateInput.module.css';

interface DateInputProps {
	defaultValue?: string;
	label: string;
	name: string;
}

export function DateInput({ 
	defaultValue,
	label, 
	name,
	...rest
}: DateInputProps) {
	return (
		<fieldset 
			{...rest}
			class={styles.fieldset} 
			name={name}
		>
			<legend>{label}</legend>

			<TextInput
				inputMode="numeric"
				label="Month"
				name={`${name}-month}`}
				pattern="[0-9]{1,2}"
			/>

			<TextInput
				inputMode="numeric"
				label="Day"
				name={`${name}-day}`}
				pattern="[0-9]{1,2}"
			/>

			<TextInput
				inputMode="numeric"
				label="Year"
				name={`${name}-year}`}
				pattern="[0-9]{4}"
			/>
		</fieldset>
	);
}
