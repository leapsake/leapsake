import { SiteHeader } from '../SiteHeader';

export function Welcome({
	children,
	title = "Leapsake",
}) {
	return (
		<>
			<SiteHeader />
			<main id="main">
				<h1>{title}</h1>
				{children}
			</main>
		</>
	);
}
