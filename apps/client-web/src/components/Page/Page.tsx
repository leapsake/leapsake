import { Fragment } from 'react';
import styles from './Page.module.css';

export default function Page({
	actions,
	children,
	title,
}) {
	return (
		<Fragment>
			<header className={styles.header}>
				<h1>{title}</h1>

				{actions}
			</header>

			{children}
		</Fragment>
	);
}
