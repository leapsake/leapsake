import styles from './Name.module.css';

interface NameProps {
	title?: Element | string;
	givenName?: string;
	middleName?: string;
	familyName?: string;
}

export function Name({
	title = 'Name',
	givenName,
	middleName,
	familyName
}: NameProps) {
	return (
		<section>
			{title}

			<div class={styles.name}>
				{givenName && <div><strong>First Name</strong><div>{givenName}</div></div>}
				{middleName && <div><strong>Middle Name</strong><div>{middleName}</div></div>}
				{familyName && <div><strong>Last Name</strong><div>{familyName}</div></div>}
			</div>
		</section>
	);
}
