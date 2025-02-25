import { Fragment } from 'react';
import Button from '@/components/Button';
import EmailInput from '@/components/EmailInput';
import PasswordInput from '@/components/PasswordInput';

export default function Login() {
	return (
		<Fragment>
			<h1>Log In to Leapsake</h1>

			<form>
				<EmailInput />

				<PasswordInput />

				<Button type="submit">Log In</Button>
			</form>
		</Fragment>
	);
}
