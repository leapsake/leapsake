import { ReactNode } from 'react';
import Link from 'next/link';

interface Props {
	children: ReactNode;
	href: string;
};

export default function Button({ children, href, ...rest }: Props) {
	if (href) {
		return (
			<Link
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
