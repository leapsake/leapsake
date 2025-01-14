import { Fragment } from 'react';
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
					<Fragment>
						<BaseInput
							label="Label"
							list="milestone-labels"
							name="label"
							type="text"
						/>

						<datalist id="milestone-labels">
							<option value="Adoption"></option>
							<option value="Anniversary"></option>
							<option value="Birthday"></option>
							<option value="Engagement"></option>
							<option value="First Date"></option>
							<option value="Graduation"></option>
							<option value="Moved"></option>
						</datalist>
					</Fragment>
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
