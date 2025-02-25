import BaseInput from '@/components/BaseInput';
import Form from '@/components/Form';

export default function PhoneNumberForm({
	action,
	phoneNumber = {},
	submitButtonContent,
}) {
	return (
		<Form
			action={action} name="phone-number"
			submitButtonContent={submitButtonContent}
		>
			<BaseInput
				defaultValue={phoneNumber.label}
				label="Label"
				list="number-labels"
				name="label"
			/>

			<datalist id="number-labels">
				<option value="Home"></option>
				<option value="Mobile"></option>
				<option value="Work"></option>
			</datalist>

			<BaseInput
				defaultValue={phoneNumber.number}
				label="Phone Number"
				name="number"
			/>
		</Form>
	);
}
