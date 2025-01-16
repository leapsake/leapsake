import styles from './AutoUploadInput.module.css';

export default function AutoUploadInput({
	accept,
	children,
	multiple = false,
	name,
}) {
	return (
		<label>
			<span>{ children }</span>
			<input
				accept={accept}
				className={styles.input}
				multiple={multiple}
				name={name}
				type="file"
			/>
		</label>
	);
}
