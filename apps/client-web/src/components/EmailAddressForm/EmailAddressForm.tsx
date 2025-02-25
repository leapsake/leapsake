import BaseInput from '@/components/BaseInput';
import Form from '@/components/Form';

export default function EmailAddressForm({
	action,
	submitButtonContent,
	emailAddress = {},
}) {
	return (
		<Form
			action={action}
			submitButtonContent={submitButtonContent}
			name="email"
		>
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
		</Form>
	);
}
