import { SkipLink } from '@/components/SkipLink';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
	return (
		<>
			<SkipLink />
			<header class={styles.header}>
				<nav class={styles.nav}>
					<a class={styles.logo} href="/">🐸 Leapsake</a>

					<ul class={styles.list}>
						<li><a href="/download">Download</a></li>
					</ul>
				</nav>
			</header>
		</>
	);
}
