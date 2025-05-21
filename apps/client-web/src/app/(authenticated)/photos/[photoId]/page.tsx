import Image from '@/components/Image'
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';
import Page from '@/components/Page';
import { Photo } from '@/types';
import {
	readPhoto,
} from '@/actions';

type Props = {
	params: Promise<{ photoId: string }>
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
			</footer>
		</Page>
	);
}
