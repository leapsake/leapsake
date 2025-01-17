import { Fragment } from 'react';
import Link from 'next/link';
// import { browsePhotos } from '@/db/photos';

export default async function BrowsePhotosPage() {
	//const photos = await browsePhotos();
	const photos = [];

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
				{photos.map((photos) => (
					<li key={photos.id}>
						<Link href={`/photos/${photo.id}`}>Photo</Link>
					</li>
				))}
			</ul>
		</Fragment>
	);
}
