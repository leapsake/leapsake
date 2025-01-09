import BaseInput from '@/components/BaseInput';

export default function EmailInput({
	label = 'Email Address',
	name = 'email',
	value,
}) {
	return (
		<BaseInput
			label={label}
			name={name}
			type="email"
			value={value}
		/>
	)
}
