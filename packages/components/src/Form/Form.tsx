import { JSX } from 'preact';
import { useState, useEffect } from 'preact/hooks';

function useJavaScriptIsEnabled() {
	const [isEnabled, setIsEnabled] = useState(false);

	useEffect(() => {
		setIsEnabled(true);
	}, []);

	return isEnabled;
}

type BaseForm = JSX.IntrinsicElements['form'];

type FormWithAction = BaseForm & {
	action: string;
};

type FormWithOnSubmit = BaseForm & {
	onSubmit: (e: SubmitEvent) => void;
}

type FormProps = FormWithAction | FormWithOnSubmit;

export function Form({
	children,
	...rest
}: FormProps) {
	const javaScriptIsEnabled = useJavaScriptIsEnabled();

	if (javaScriptIsEnabled) {

	}

	return (
		<form {...rest}>
			{children}
		</form>
	);
}
