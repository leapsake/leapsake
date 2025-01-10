import styles from './BaseInput.module.css';

export default function BaseInput({
	defaultValue,
	label,
	name,
	type = 'text',
	value,
}) {
	return (
		<div>
			<label>
				<div className={styles.label}>{label}</div>

				<input
					className={styles.input}
					defaultValue={defaultValue}
					name={name}
					type={type}
					value={value}
				/>
			</label>
		</div>
	)
}
