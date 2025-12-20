import styles from './Titlebar.module.css';
import { Omnibox } from '@leapsake/components';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useState, useEffect } from 'preact/hooks';

export function Titlebar() {
	const [inputElement, setInputElement] = useState<HTMLInputElement | null>(null);

	useEffect(() => {
		if (!inputElement) return;

		const shortcut = 'CommandOrControl+K';

		const registerShortcut = async () => {
			await register(shortcut, (event) => {
				if (event.state === 'Pressed') {
					inputElement.focus();
				}
			});
		};

		registerShortcut().catch(console.error);

		return () => {
			unregister(shortcut).catch(console.error);
		};
	}, [inputElement]);

	return (
		<div class={styles.titlebar}>
			<div class={styles.titlebarContent} data-tauri-drag-region>
				<Omnibox onInputMount={setInputElement} />
			</div>
		</div>
	);
}
