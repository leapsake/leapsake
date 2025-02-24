import styles from './DateInput.module.css';
import BaseInput from '@/components/BaseInput';

export default function DateInput({
	day,
	label = 'Date',
	month,
	name = 'date',
	year,
}) {

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
