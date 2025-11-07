import { SkipLink } from '../SkipLink';
import styles from './SiteHeader.module.css';

export function SiteHeader() {
	return (
		<>
			<SkipLink />
			<header class={styles.header}>
				<nav class={styles.nav}>
					<a class={styles.logo} href="/">Leapsake</a>

					<ul class={styles.list}>
						<li><a href="/about">About</a></li>
						<li><a href="/download">Download</a></li>
						<li><a href="/pricing">Pricing</a></li>
					</ul>
				</nav>
			</header>
		</>
	);
}
