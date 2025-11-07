import { HTMLHead } from '@/components/HTMLHead';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

interface HTMLPageProps {
	children: any;
	lang?: string;
	title?: string;
}

export function HTMLPage({
	children,
	lang = 'en-US',
	title = 'Leapsake - Keep memories, make memories',
}: HTMLPageProps) {
	return (
		<html lang={lang}>
			<HTMLHead title={title} />
			<body>
				<SiteHeader />
				<main id="main">
					{children}
				</main>
				<SiteFooter />
			</body>
		</html>
	);
}
