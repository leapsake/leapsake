import { Fragment } from 'react';
import type { Metadata } from 'next';
import { Actions, Action } from '@/components/Actions';
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

				<Actions>
					<Action href="/photos/new">
						<span>➕ Add photos</span>
					</Action>
				</Actions>
			</header>

			<ThumbnailGallery
				thumbnails={photos}
			/>
		</Fragment>
	);
}
