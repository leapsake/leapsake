import styles from './TextArea.module.css';

export default function TextArea({
	defaultValue,
	label,
	name,
	value,
}) {
	return (
		<div>
			<label>
				<div className={styles.label}>{label}</div>

				<textarea
					className={styles.input}
					defaultValue={defaultValue}
					name={name}
					value={value}
				/>
			</label>
		</div>
	)
}
