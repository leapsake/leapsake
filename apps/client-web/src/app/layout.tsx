import SkipNavLink from '@/components/SkipNavLink';

import './global.css';

export const metadata = {
	title: 'Leapsake',
	description: '',
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en-US">
			<body>
				<SkipNavLink />

				{ children }
			</body>
		</html>
	);
}
