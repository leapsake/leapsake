import { Fragment } from 'react';
import EmailInput from '@/components/EmailInput';
import Form from '@/components/Form';
import PasswordInput from '@/components/PasswordInput';

export default function Login() {
	return (
		<Fragment>
			<h1>Log In to Leapsake</h1>

			<Form
				submitButtonContent="Log In"
			>
				<EmailInput />

				<PasswordInput />
			</Form>
		</Fragment>
	);
}
