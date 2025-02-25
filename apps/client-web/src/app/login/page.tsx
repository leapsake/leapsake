import EmailInput from '@/components/EmailInput';
import Form from '@/components/Form';
import Page from '@/components/Page';
import PasswordInput from '@/components/PasswordInput';

export default function Login() {
	return (
		<Page
			title="Log In to Leapsake"
		>
			<Form
				submitButtonContent="Log In"
			>
				<EmailInput />

				<PasswordInput />
			</Form>
		</Page>
	);
}
