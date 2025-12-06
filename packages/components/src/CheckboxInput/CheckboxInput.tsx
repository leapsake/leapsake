interface CheckboxInputProps {
	defaultChecked?: boolean;
	label: string;
	name: string;
}

export function CheckboxInput({
	defaultChecked,
	label,
	name,
	...rest
}: CheckboxInputProps) {
	return (
		<label>
			<input
				{...rest}
				defaultChecked={defaultChecked}
				type="checkbox"
				name={name}
			/>
			<span>{label}</span>
		</label>
	);
}
