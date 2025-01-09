import { useEffect, useState } from 'react';

export function useJavaScriptIsEnabled() {
	const [javaScriptIsEnabled, setJavaScriptIsEnabled] = useState(false);
	useEffect(() => {
		setJavaScriptIsEnabled(true);
	}, []);

	return javaScriptIsEnabled;
}
