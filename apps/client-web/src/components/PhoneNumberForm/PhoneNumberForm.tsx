import BaseInput from '@/components/BaseInput';
import Button from '@/components/Button';

export default function PhoneNumberForm({
	action,
	buttonText = 'Submit',
	phoneNumber = {},
}) {
	return (
		<form action={action} name="phone-number">
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

			<Button type="submit">{buttonText}</Button>
		</form>
	);
}
