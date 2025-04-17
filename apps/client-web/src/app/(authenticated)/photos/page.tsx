import type { Metadata } from 'next';
import { Actions, Action } from '@/components/Actions';
import Page from '@/components/Page';
import ThumbnailGallery from '@/components/ThumbnailGallery';
import { browsePhotos } from '@/actions';
import { Photo } from '@/types';
import { getPageTitle } from '@/utils';

export const metadata: Metadata = {
	title: getPageTitle('Photos'),
}

export default async function BrowsePhotosPage() {
	const photos = await browsePhotos() as Photo[];

	return (
		<Page
			actions={(
				<Actions>
					<Action href="/photos/new">
						<span>➕ Add photos</span>
					</Action>
				</Actions>
			)}
			title="Photos"
		>
			<ThumbnailGallery
				thumbnails={photos}
			/>
		</Page>
	);
}
