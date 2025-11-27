import { TextInput } from '../TextInput';

interface EmailAddressInputProps {
	defaultValue?: string;
	label?: string;
	name?: string;
}

export function EmailAddressInput({
	defaultValue,
	label = 'Email',
	name = 'email',
	...rest
}: EmailAddressInputProps) {
	return (
		<TextInput
			{...rest}
			defaultValue={defaultValue}
			inputMode="email"
			label={label}
			name={name}
			type="email"
		/>
	);
}
