import styles from './ContactName.module.css';

interface ContactNameProps {
	title?: Element | string;
	givenName?: string;
	middleName?: string;
	familyName?: string;
}

export function ContactName({
	title = 'Name',
	givenName,
	middleName,
	familyName
}: ContactNameProps) {
	return (
		<section>
			{title}

			<div class={styles.name}>
				<ContactNamePart
					label="First Name"
					name={givenName}
				/>
				<ContactNamePart
					label="Middle Name"
					name={middleName}
				/>
				<ContactNamePart
					label="Last Name"
					name={familyName}
				/>
			</div>
		</section>
	);
}

export function ContactNamePart({ label, name }: { label: string; name?: string; }) {
	return (
		<div>
			<b>{label}</b>
			<div class={styles.namePartValue}>{name}</div>
		</div>
	);
}
