import { Fragment } from 'react';
import Link from 'next/link'

export default function NotFound() {
	return (
		<Fragment>
			<h2>Not Found</h2>
			<Link href="/">Return Home</Link>
		</Fragment>
	)
}
