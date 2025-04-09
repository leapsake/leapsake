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
				<div className={styles.headerContent}>
					<h1>{title}</h1>

					{actions}
				</div>
			</header>

			<div className={styles.body}>
				{children}
			</div>
		</Fragment>
	);
}
