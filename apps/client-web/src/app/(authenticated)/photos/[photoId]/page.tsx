import type { Metadata } from 'next';
import { Actions, Action } from '@/components/Actions';
import Image from '@/components/Image'
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';
import Page from '@/components/Page';
import { Photo } from '@/types';
import {
	readPhoto,
} from '@/actions';
import { getPageTitle } from '@/utils';

type Props = {
	params: Promise<{ photoId: string }>
}

export const metadata: Metadata = {
	title: getPageTitle('Photos'),
}

export default async function ReadPhotoPage({ params }: Props) {
	const { photoId } = await params;
	const photo = await readPhoto(photoId) as Photo;

	return (
		<Page>
			<div>
				<Image
					alt=""
					src={photo.path}
				/>
			</div>

			<footer>
				<CreatedUpdatedMetadata
					createdAt={photo.created_at}
					updatedAt={photo.updated_at}
				/>

				<Actions>
					<Action
						href={`/photos/${photoId}/edit`}
					>
						{`📝 Edit photo`}
					</Action>

					<Action
						href={`/photos/${photoId}/edit`}
					>
						{`🏷️ Tag photo`}
					</Action>

					<Action
						href={`/photos/${photoId}/delete`}
						variant="danger"
					>
						{`❌ Delete photo`}
					</Action>
				</Actions>
			</footer>
		</Page>
	);
}
