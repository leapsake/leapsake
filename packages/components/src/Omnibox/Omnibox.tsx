import styles from './Omnibox.module.css';
import { Form } from '../Form';

interface OmniboxProps {
	onInputMount?: (input: HTMLInputElement | null) => void;
	onSubmit?: (value: string) => void;
}

export function Omnibox({ onInputMount, onSubmit }: OmniboxProps) {
	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (onSubmit) {
			const formData = new FormData(e.currentTarget as HTMLFormElement);
			const query = formData.get('q') as string;
			onSubmit(query);
		}
	};

	return (
		<search>
			<Form onSubmit={handleSubmit}>
				<input
					ref={onInputMount}
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
