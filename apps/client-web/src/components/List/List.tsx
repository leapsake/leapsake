import styles from './List.module.css';

export default function List({ children }) {
	return (
		<ul className={styles.list}>
			{children}
		</ul>
	);
}
