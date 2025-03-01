import styles from './List.module.css';

export default function List({ header, children, footer }) {
	return (
		<section className={styles.section}>
			{header}
			<ul className={styles.list}>
				{children}
			</ul>
			{footer}
		</section>
	);
}
