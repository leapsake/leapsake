import { JSX } from 'preact';

import styles from './Button.module.css';

type ButtonAsButton = JSX.IntrinsicElements['button'] & {
	href?: never;
	type?: 'button' | 'submit' | 'reset';
};

type ButtonAsLink = JSX.IntrinsicElements['a'] & {
	href: string;
	target?: string;
	rel?: string;
	download?: string | boolean;
};

type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
	const { children } = props;

	if ('href' in props && props.href) {
		const { href, target, rel, download, ...anchorRest } = props;
		return (
			<a {...anchorRest} class={styles.button} href={href} target={target} rel={rel} download={download}>
				{children}
			</a>
		);
	}

	const { type, ...buttonRest } = props as ButtonAsButton;
	return (
		<button class={styles.button} type={type} {...buttonRest}>
			{children}
		</button>
	);
}
