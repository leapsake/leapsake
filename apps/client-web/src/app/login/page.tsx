import { Fragment } from 'react';

import EmailInput from '@/components/EmailInput';
import PasswordInput from '@/components/PasswordInput';

export default function Login() {
	return (
		<Fragment>
			<h1>Log In to Leapsake</h1>

			<form>
				<EmailInput />

				<PasswordInput />

				<button type="submit">Log In</button>
			</form>
		</Fragment>
	);
}
