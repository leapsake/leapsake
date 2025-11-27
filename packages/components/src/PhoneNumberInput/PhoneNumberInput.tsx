import { TextInput } from '../TextInput';
import { CheckboxInput } from '../CheckboxInput';

interface PhoneNumberInputProps {
	defaultValue?: string;
	label?: string;
	name?: string;
}

export function PhoneNumberInput({
	defaultValue,
	label = 'Phone',
	name = 'phone',
	...rest
}: PhoneNumberInputProps) {
	return (
		<fieldset>
			<legend>{label}</legend>
			<TextInput
				{...rest}
				defaultValue={defaultValue}
				inputMode="tel"
				label={label}
				name={name}
				type="tel"
			/>
			<CheckboxInput label="Call" name="call" />
			<CheckboxInput label="Text" name="text" />
		</fieldset>
	);
}
