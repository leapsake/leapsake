import { type ComponentChildren } from 'preact';
import styles from './ScreenContainer.module.css';

interface ScreenContainerProps {
	children: ComponentChildren;
};

export function ScreenContainer({ children }: ScreenContainerProps) {
	return (
		<div class={styles.screen}>
			{children}
		</div>
	);
}
