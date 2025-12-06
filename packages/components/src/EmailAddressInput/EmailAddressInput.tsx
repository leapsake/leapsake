import { TextInput } from '../TextInput';

interface EmailAddressInputProps {
	defaultValue?: string;
	defaultLabel?: string;
	label?: string;
	name?: string;
}

export function EmailAddressInput({
	defaultValue,
	defaultLabel,
	label = 'Email',
	name = 'email',
	...rest
}: EmailAddressInputProps) {
	return (
		<div>
			<TextInput
				{...rest}
				defaultValue={defaultValue}
				inputMode="email"
				label={label}
				name={`${name}.email`}
				type="email"
			/>
			<TextInput
				defaultValue={defaultLabel}
				label="Label"
				name={`${name}.label`}
				placeholder="e.g., work, personal"
			/>
		</div>
	);
}
