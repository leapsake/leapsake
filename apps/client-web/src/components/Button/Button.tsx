import { ReactNode } from 'react';
import styles from './Button.module.css';
import Link from '@/components/Link';

interface Props {
	children: ReactNode;
	href: string;
};

export default function Button({ children, href, ...rest }: Props) {
	if (href) {
		return (
			<Link
				{...rest}
				href={href}
			>
				{children}
			</Link>
		);
	}

	return (
		<button
			{...rest}
		>
			{children}
		</button>
	);
}
