import { type ComponentChildren } from 'preact';
import styles from './ScreenHeader.module.css';

interface Breadcrumb {
	label: string;
	url: string;
}

interface ScreenHeaderProps {
	children: ComponentChildren;
	title: string;
	breadcrumbs?: Breadcrumb[];
};

export function ScreenHeader({ children, title, breadcrumbs }: ScreenHeaderProps) {
	return (
		<header>
			<Breadcrumbs>
				{breadcrumbs}
			</Breadcrumbs>

			<div class={styles.content}>
				<h1>{title}</h1>
				{children}
			</div>
		</header>
	);
}

function Breadcrumbs({ children }: { children?: Breadcrumb[] }) {
	if (!children || children.length < 1) {
		return null;
	}
	
	return (
		<ol class={styles.breadcrumbs}>
			{children.map((breadcrumb) => (
				<li>
					<a href={breadcrumb.url}>
						{breadcrumb.label}
					</a>
				</li>
			))}
		</ol>
	);
}
