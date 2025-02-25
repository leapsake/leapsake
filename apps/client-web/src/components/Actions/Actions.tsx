import styles from './Actions.module.css';
import Button from '@/components/Button';

export function Actions({ children }) {
	return (
		<ul className={styles.actions}>
			{children}
		</ul>
	);
}

export function Action({ ...rest }) {
	return (
		<li className={styles.action}>
			<Button
				{...rest}
			/>
		</li>
	);
}
