import { useEffect, useState } from 'preact/hooks';

export function useData(dataPromise, dependencies: any[] = []) {
	const [data, setData] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		const getData = async () => {
			try {
				const data = await dataPromise();
				setData(data);
			} catch (err) {
				setError(String(err));
			} finally {
				setIsLoading(false);
			}
		}

		getData();
	}, dependencies);

	return [data, isLoading, error];
}

/**
 * Hook for managing multiple form fields with add/remove functionality
 * @param initialData - Initial array of field data
 * @param defaultValue - Default value for new fields
 * @returns [fields, handleAdd, handleRemove, setFields]
 */
export function useFieldArray<T>(initialData: T[], defaultValue: T) {
	const [fields, setFields] = useState<T[]>(
		initialData.length > 0 ? initialData : [defaultValue]
	);

	const handleAdd = () => {
		setFields([...fields, defaultValue]);
	};

	const handleRemove = (index: number) => {
		if (fields.length > 1) {
			setFields(fields.filter((_, i) => i !== index));
		}
	};

	return [fields, handleAdd, handleRemove, setFields] as const;
}
