import { type ComponentChildren } from 'preact';
import styles from './ScreenHeader.module.css';

interface ScreenHeaderProps {
	children: ComponentChildren;
	title: string;
};

export function ScreenHeader({ children, title }: ScreenHeaderProps) {
	return (
		<header class={styles.header}>
			<h1>{title}</h1>
			{children}
		</header>
	);
}
