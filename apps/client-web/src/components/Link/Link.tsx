import { ReactNode } from 'react';
import { default as NextLink } from 'next/link';

interface Props {
	children: ReactNode;
	href: string;
};

export default function Link({ children, href, ...rest }: Props) {
	return (
		<NextLink
			{...rest}
			href={href}
		>
			{children}
		</NextLink>
	);
}
