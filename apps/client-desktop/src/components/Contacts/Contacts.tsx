import type { ComponentChildren } from 'preact';
import styles from './Contacts.module.css';

interface ContactsProps {
	children: ComponentChildren;
};

export function Contacts({ children }: ContactsProps) {
	return (
		<div class={styles.screen}>
			{children}
		</div>
	);
}
