import BaseInput from '@/components/BaseInput';
import Button from '@/components/Button';

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

			<BaseInput
				defaultValue={person.maiden_name}
				label="Maiden Name"
				name="maiden_name"
			/>

			<Button type="submit">{buttonText}</Button>
		</form>
	);
}
