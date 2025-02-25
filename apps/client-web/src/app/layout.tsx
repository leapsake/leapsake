import Link from 'next/link';
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
				<header>
					<nav aria-label="Home Navigation">
						<Link href="/">🐸 Leapsake</Link>
					</nav>
				</header>

				<div className={styles.body}>
					<nav aria-label="Feature Navigation">
						<ul className={styles.featureNavList}>
							<li>
								<Link href="/people">👪 People</Link>
							</li>
							<li>
								<Link href="/photos">📷 Photos</Link>
							</li>
						</ul>
					</nav>

					<main id="main">
						{children}
					</main>
				</div>
			</body>
		</html>
	);
}
