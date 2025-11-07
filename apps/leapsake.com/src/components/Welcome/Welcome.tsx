export function Welcome({
	title = "Leapsake",
}) {
	return (
		<main>
			<h1>{title}</h1>
			<ul>
				<li><a href="/">Home</a></li>
				<li><a href="/about">About</a></li>
				<li><a href="/download">Download</a></li>
			</ul>
		</main>
	);
}
