"use client"

import { Fragment, useState } from 'react';

import BaseInput from '@/components/BaseInput';
import { useJavaScriptIsEnabled } from '@/hooks';

export default function PasswordInput({
	label = 'Password',
	name = 'password',
	value,
}) {
	const [passwordIsHidden, setPasswordIsHidden] = useState(true);

	const type = passwordIsHidden ? 'password' : 'text';
	const buttonText = passwordIsHidden ? 'Show Password' : 'Hide Password';
	const onClick = () => {
		setPasswordIsHidden(!passwordIsHidden);
	}

	const javaScriptIsEnabled = useJavaScriptIsEnabled();

	return (
		<BaseInput
			label={(
				<Fragment>
					<div>{label}</div>

					{javaScriptIsEnabled && (
						<button onClick={onClick} type="button">
							{buttonText}
						</button>
					)}
				</Fragment>
			)}
			name={name}
			type={type}
			value={value}
		/>
	)
}
