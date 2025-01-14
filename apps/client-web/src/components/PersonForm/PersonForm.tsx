import BaseInput from '@/components/BaseInput';

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

			<button type="submit">{buttonText}</button>
		</form>
	);
}
