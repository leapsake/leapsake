import BaseInput from '@/components/BaseInput';
import Button from '@/components/Button';

export default function EmailAddressForm({
	action,
	buttonText = 'Submit',
	emailAddress = {},
}) {
	return (
		<form action={action} name="email">
			<BaseInput
				defaultValue={emailAddress.label}
				label="Label"
				list="email-labels"
				name="label"
			/>

			<datalist id="email-labels">
				<option value="Personal"></option>
				<option value="Work"></option>
				<option value="School"></option>
			</datalist>

			<BaseInput
				defaultValue={emailAddress.address}
				label="Email Address"
				name="address"
			/>

			<Button type="submit">{buttonText}</Button>
		</form>
	);
}
