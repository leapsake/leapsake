import { JSX } from 'preact';

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
		<label>
			<div>{label}</div>
			<input 
				{...rest} 
				inputMode={inputMode}
				type={type} 
			/>
		</label>
	);
}

