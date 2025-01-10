import BaseInput from '@/components/BaseInput';

export default function DateInput({
	defaultValue,
	label = 'Date',
	name = 'date',
	value,
}) {
	const dateValue = value || defaultValue || '';
	const [year, month, day] = dateValue.split('-');

	return (
		<fieldset name={name}>
			<legend>{label}</legend>

			<BaseInput
				defaultValue={month}
				label="Month"
				name="month"
				type="text"
			/>

			<BaseInput
				defaultValue={day}
				label="Day"
				name="day"
				type="text"
			/>

			<BaseInput
				defaultValue={year}
				label="Year"
				name="year"
				type="text"
			/>
		</fieldset>
	)
}
