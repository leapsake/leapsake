import styles from './SkipLink.module.css';

export function SkipLink({
	children = 'Skip to main content',
	href = '#main',
}) {
	return (
		<a class={styles.skipLink} href={href}>{children}</a>
	);
}
