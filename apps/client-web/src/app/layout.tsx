import Link from '@/components/Link';
import SkipNavLink from '@/components/SkipNavLink';

import './global.css';
import styles from './layout.module.css';

export const metadata = {
	title: 'Leapsake',
	description: '',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en-US">
			<body>
				<SkipNavLink />

				<header className={styles.header}>
					<nav 
						aria-label="Home Navigation"
						className={styles.homeNav}
					>
						<Link href="/">🐸 Leapsake</Link>

						<span>
							<Link href="/account">Account</Link>
						</span>
					</nav>
				</header>

				<div className={styles.body}>
					<nav aria-label="Feature Navigation" className={styles.nav}>
						<ul className={styles.featureNavList}>
							<li>
								<Link href="/people">👪 People</Link>
							</li>
							<li>
								<Link href="/photos">📷 Photos</Link>
							</li>
						</ul>
					</nav>

					<main className={styles.main} id="main">
						{children}
					</main>
				</div>
			</body>
		</html>
	);
}
