import { Fragment } from 'react';
import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';
import Form from '@/components/Form';

interface Props {

};

export default function MilestoneForm({
	action,
	submitButtonContent,
	day,
	label,
	month,
	year,
}) {
	return (
		<Form
			action={action}
			name="milestone"
			submitButtonContent={submitButtonContent}
		>
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
					<input
						name="label"
						type="hidden"
						value={label}
					/>
				)
			}

			<DateInput
				day={day}
				month={month}
				year={year}
			/>
		</Form>
	);
}
