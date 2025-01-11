import BaseInput from '@/components/BaseInput';
import styles from './DateInput.module.css';

export default function DateInput({
	label = 'Date',
	name = 'date',
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
					name={`date.${name}.month`}
					type="text"
				/>

				<BaseInput
					defaultValue={day}
					label="DD"
					name={`date.${name}.day`}
					type="text"
				/>

				<BaseInput
					defaultValue={year}
					label="YYYY"
					name={`date.${name}.year`}
					type="text"
				/>
			</div>
		</fieldset>
	)
}
