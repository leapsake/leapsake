import { Fragment } from 'react';
import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';
import { getMilestoneLabelFromType } from '@/utils';

export default function MilestoneInput({
	label,
	day,
	month,
	type,
	year,
}) {
	const isOther = !getMilestoneLabelFromType(type);

	return (
		<Fragment>
			<input type="hidden" name="type" value={type} />

			{isOther
				? (
					<BaseInput
						label="Label"
						name="label"
						type="text"
					/>
				)
				: null
			}


			<DateInput
				day={day}
				month={month}
				name={type}
				year={year}
			/>
		</Fragment>
	);
}
