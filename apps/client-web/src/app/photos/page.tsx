import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from '@/components/Link';
import ThumbnailGallery from '@/components/ThumbnailGallery';
import { browsePhotos } from '@/server';
import { Photo } from '@/types';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
	title: getPageTitle('Photos'),
}

export default async function BrowsePhotosPage() {
	const photos = await browsePhotos() as Photo[];

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

			<ThumbnailGallery
				thumbnails={photos}
			/>
		</Fragment>
	);
}
