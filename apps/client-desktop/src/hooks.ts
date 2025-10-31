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
