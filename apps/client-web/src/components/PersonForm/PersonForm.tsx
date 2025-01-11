import BaseInput from '@/components/BaseInput';
import DateInput from '@/components/DateInput';

export default function PersonForm({
	action,
	buttonText = 'Submit',
	person = {},
}) {
	return (
		<form action={action}>
			<BaseInput
				defaultValue={person.given_name}
				label="First Name"
				name="given_name"
			/>

			<BaseInput
				defaultValue={person.middle_name}
				label="Middle Name"
				name="middle_name"
			/>

			<BaseInput
				defaultValue={person.family_name}
				label="Last Name"
				name="family_name"
			/>

			<DateInput
				defaultValue={person.birth_date}
				label="Birthday"
				name="birth_date"
			/>

			<button type="submit">{buttonText}</button>
		</form>
	);
}
