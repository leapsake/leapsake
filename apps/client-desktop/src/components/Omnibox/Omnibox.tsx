import styles from './Omnibox.module.css';
import { Form } from '@/components/Form';

export function Omnibox() {
	return (
		<search>
			<Form onSubmit={Function.prototype}>
				<input 
					aria-label="Search" 
					class={styles.input}
					inputMode="text" 
					name="q"
					placeholder="Search..."
					type="text"
				/>
				<noscript>
					<button type="submit">Search</button>
				</noscript>
			</Form>
		</search>
	);
}
