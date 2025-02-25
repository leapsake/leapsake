import { ReactNode } from 'react';
import styles from './Button.module.css';
import Link from '@/components/Link';

interface Props {
	children: ReactNode;
	href: string;
};

function getClassNames(variant) {
	const classArray = [ styles.button ];

	switch (variant) {
		case "danger":
			classArray.push(styles['button--danger']);
			break;
		default:
			break;
	}

	const classNames = classArray.join(' ');
	return classNames;
}

export default function Button({
	children,
	href,
	variant,
	...rest
}: Props) {
	const classNames = getClassNames(variant);

	if (href) {
		return (
			<Link
				{...rest}
				className={classNames}
				href={href}
			>
				{children}
			</Link>
		);
	}

	return (
		<button
			{...rest}
			className={classNames}
		>
			{children}
		</button>
	);
}
