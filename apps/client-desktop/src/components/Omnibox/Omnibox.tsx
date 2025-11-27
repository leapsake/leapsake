import styles from './Omnibox.module.css';
import { Form } from '@leapsake/components';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useRef, useEffect } from 'preact/hooks';


export function Omnibox() {
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const shortcut = 'CommandOrControl+K';

		const registerShortcut = async () => {
			await register(shortcut, (event) => {
				if (event.state === 'Pressed' && input.current) {
					input.current.focus();
				}
			});
		};

		registerShortcut().catch(console.error);

		return () => {
			unregister(shortcut).catch(console.error);
		};
	}, []);

	return (
		<search>
			<Form onSubmit={Function.prototype}>
				<input 
					aria-label="Search" 
					class={styles.input}
					inputMode="text" 
					name="q"
					placeholder="Search..."
					ref={input}
					type="text"
				/>
				<noscript>
					<button type="submit">Search</button>
				</noscript>
			</Form>
		</search>
	);
}
