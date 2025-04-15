import { Fragment } from 'react';
import { redirect } from 'next/navigation';

import Link from '@/components/Link';
import styles from './layout.module.css';

export const metadata = {
	title: 'Leapsake',
	description: '',
};

function getAuth() {
	return {};
}

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { user } = getAuth();

	if (user) {
		return redirect('/');
	}

	return (
		<Fragment>
			<header className={styles.header}>
				<nav 
					aria-label="Home Navigation"
					className={styles.homeNav}
				>
					<Link href="/">🐸 Leapsake</Link>
				</nav>
			</header>

			<main className={styles.main} id="main">
				{children}
			</main>
		</Fragment>
	);
}
