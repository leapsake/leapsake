import { TextInput } from '../TextInput';
import { CheckboxInput } from '../CheckboxInput';

interface PhoneNumberInputProps {
	defaultValue?: string;
	defaultLabel?: string;
	defaultCanCall?: boolean;
	defaultCanText?: boolean;
	label?: string;
	name?: string;
}

export function PhoneNumberInput({
	defaultValue,
	defaultLabel,
	defaultCanCall = true,
	defaultCanText = true,
	label = 'Phone',
	name = 'phone',
	...rest
}: PhoneNumberInputProps) {
	return (
		<div>
			<TextInput
				{...rest}
				defaultValue={defaultValue}
				inputMode="tel"
				label={label}
				name={`${name}.number`}
				type="tel"
			/>
			<TextInput
				defaultValue={defaultLabel}
				label="Label"
				name={`${name}.label`}
				placeholder="e.g., work, personal, mobile"
			/>
			<CheckboxInput
				defaultChecked={defaultCanCall}
				label="Call"
				name={`${name}.call`}
			/>
			<CheckboxInput
				defaultChecked={defaultCanText}
				label="Text"
				name={`${name}.text`}
			/>
		</div>
	);
}
