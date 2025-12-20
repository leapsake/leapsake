import styles from './Details.module.css';
import { type ComponentChildren } from 'preact';

interface DetailsProps {
	children: ComponentChildren;
	summary: Element | string;
};

export function Details({ children, summary }: DetailsProps) {
	return (
		<details>
			<summary class={styles.summary}>{summary}</summary>
			<div>
				{children}
			</div>
		</details>
	);
}
