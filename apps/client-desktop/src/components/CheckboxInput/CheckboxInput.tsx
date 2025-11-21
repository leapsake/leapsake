interface CheckboxInputProps {
	label: string;
	name: string;
}

export function CheckboxInput({
	label,
	name,
}: CheckboxInputProps) {
	return (
		<label>
			<input type="checkbox" name={name} />
			<span>{label}</span>
		</label>
	);
}
