import BaseInput from '@/components/BaseInput';

export default function DateInput({
	defaultValue,
	label = 'Date',
	name = 'date',
	value,
}) {
	return (
		<BaseInput
			defaultValue={defaultValue}
			label={label}
			name={name}
			type="date"
			value={value}
		/>
	)
}
