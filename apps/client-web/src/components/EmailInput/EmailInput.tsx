import TextInput from '@/components/TextInput';

export default function EmailInput({
	label = 'Email Address',
	name = 'email',
	value,
}) {
	return (
		<TextInput
			label={label}
			name={name}
			type="email"
			value={value}
		/>
	)
}
