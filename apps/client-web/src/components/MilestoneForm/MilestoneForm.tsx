import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';

export default function MilestoneForm({
	action,
	buttonText = 'Submit',
	label,
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

			<DateInput />

			<button type="submit">{buttonText}</button>
		</form>
	);
}
