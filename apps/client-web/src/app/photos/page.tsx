import { Fragment } from 'react';
import Link from 'next/link';
import { browsePhotos } from '@/server';

export default async function BrowsePhotosPage() {
	const photos = await browsePhotos();

	return (
		<Fragment>
			<header>
				<h1>Photos & Videos</h1>

				<ul>
					<li>
						<Link href="/photos/new">
							<span>➕ Add photos</span>
						</Link>
					</li>
				</ul>
			</header>

			<ul>
				{photos.map((photo) => (
					<li key={photo.id}>
						<Link href={`/photos/${photo.id}`}>{photo.path}</Link>
					</li>
				))}
			</ul>
		</Fragment>
	);
}
