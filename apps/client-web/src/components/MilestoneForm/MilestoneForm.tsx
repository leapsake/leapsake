import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';

export default function MilestoneForm({
	action,
	buttonText = 'Submit',
	day,
	label,
	month,
	year,
}) {
	return (
		<form action={action} name="milestone">
			{!label
				? (
					<BaseInput
						label="Label"
						name="label"
						type="text"
					/>
				)
				: (
					<input type="hidden" name="label" value={label} />
				)
			}

			<DateInput
				day={day}
				month={month}
				year={year}
			/>

			<button type="submit">{buttonText}</button>
		</form>
	);
}
