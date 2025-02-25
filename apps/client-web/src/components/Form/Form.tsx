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
	...rest
}: Props) {
	return (
		<form
			action={action}
			name={name}
			{...rest}
		>
			{children}

			<Button type="submit">{submitButtonContent}</Button>
		</form>
	);
}
