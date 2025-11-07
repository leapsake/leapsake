export function HTMLHead({ title }) {
	return (
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width" />
			<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐸</text></svg>" />
			<title>{title}</title>
			<style>
			{`
				body {
					margin: 0;
					padding: 0;
					width: 100%;
				}
			`}
			</style>
		</head>
	);
}
