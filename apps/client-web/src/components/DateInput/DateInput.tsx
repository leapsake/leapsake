import BaseInput from '@/components/BaseInput';
import styles from './DateInput.module.css';

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

			<div className={styles.body}>
				<BaseInput
					defaultValue={month}
					label="MM"
					name="month"
					type="text"
				/>

				<BaseInput
					defaultValue={day}
					label="DD"
					name="day"
					type="text"
				/>

				<BaseInput
					defaultValue={year}
					label="YYYY"
					name="year"
					type="text"
				/>
			</div>
		</fieldset>
	)
}
