import { JSX } from 'preact';
import styles from './TextInput.module.css';

type TextInputProps = JSX.IntrinsicElements['input'] & {
	label: string;
	name: string;
}

export function TextInput({
	inputMode = 'text',
	label,
	type = "text",
	...rest
}: TextInputProps) {
	return (
		<label class={styles.wrapper}>
			<div>{label}</div>
			<input
				{...rest}
				inputMode={inputMode}
				type={type}
			/>
		</label>
	);
}
