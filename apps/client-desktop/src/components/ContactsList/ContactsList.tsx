import { type Contact } from '../../types';
import styles from './ContactsList.module.css';

interface ContactsListProps {
	contacts: Contact[];
};

export function ContactsList({ contacts }: ContactsListProps) {
	return (
		<ol class={styles.list}>
			{contacts.map((contact) => (
				<li>
					<a href={contact.path}>
						{contact.file_name}
					</a>
				</li>
			))}
		</ol>
	);
}
