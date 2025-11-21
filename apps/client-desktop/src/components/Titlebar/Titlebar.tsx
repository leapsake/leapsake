import styles from './Titlebar.module.css';
import { Omnibox } from '@/components/Omnibox';

export function Titlebar() {
	return (
		<div class={styles.titlebar}>
			<div class={styles.titlebarContent} data-tauri-drag-region>
				<Omnibox />
			</div>
		</div>
	);
}
