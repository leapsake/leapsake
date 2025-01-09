import TextInput from '@/components/TextInput';

export default function DateInput({
	defaultValue,
	label = 'Date',
	name = 'date',
	value,
}) {
	return (
		<TextInput
			defaultValue={defaultValue}
			label={label}
			name={name}
			type="date"
			value={value}
		/>
	)
}
