import styles from './Options.module.css';
import Button from '@/components/Button';

export function Options({ children }) {
	return (
		<ul className={styles.options}>
			{children}
		</ul>
	);
}

export function Option({ ...rest }) {
	return (
		<li>
			<Button
				className={styles.option}
				{...rest}
			/>
		</li>
	);
}
