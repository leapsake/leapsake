import { SocialMediaLinks } from '../SocialMediaLinks';
import styles from './SiteFooter.module.css';

export function SiteFooter() {
	return (
		<footer class={styles.footer}>
			<SocialMediaLinks />
		</footer>
	);
}
