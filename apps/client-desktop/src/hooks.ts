import { useEffect, useState } from 'preact/hooks';

export function useData(dataPromise) {
	const [data, setData] = useState(null);
	const [isLoading, setIsLoading] = useState(true);

	
	useEffect(() => {
		const getData = async () => {
			const data = await dataPromise();
			setData(data);
			setIsLoading(false);
		}
		
		getData();
	}, []);

	return [data, isLoading];
}
