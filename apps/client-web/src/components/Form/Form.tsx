import { ReactNode } from 'react';
import Button from '@/components/Button';

interface Props {
	action: any;
	children?: ReactNode;
	name: string;
	submitButtonContent?: ReactNode;
};

export default function Form({
	action,
	children,
	name,
	submitButtonContent = 'Submit',
	submitButtonVariant,
	...rest
}: Props) {
	return (
		<form
			action={action}
			name={name}
			{...rest}
		>
			{children}

			<Button
				type="submit"
				variant={submitButtonVariant}
			>
				{submitButtonContent}
			</Button>
		</form>
	);
}
