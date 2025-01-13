import BaseInput from '@/components/BaseInput';
import styles from './MilestoneInput.module.css';

export default function MilestoneInput({
	label = 'Date',
	name = 'other',
	day,
	month,
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
