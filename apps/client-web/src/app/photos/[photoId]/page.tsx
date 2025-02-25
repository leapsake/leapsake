import { Fragment } from 'react';
import Image from '@/components/Image'
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';
import { Photo } from '@/types';
import {
	readPhoto,
} from '@/server';

type Props = {
	params: Promise<{ photoId: string }>
}

export default async function ReadPhotoPage({ params }: Props) {
	const { photoId } = await params;
	const photo = await readPhoto(photoId) as Photo;

	return (
		<Fragment>
			<div>
				<Image
					alt=""
					height={50}
					width={50}
					src={photo.path}
				/>
			</div>

			<footer>
				<CreatedUpdatedMetadata
					createdAt={photo.created_at}
					updatedAt={photo.updated_at}
				/>
			</footer>
		</Fragment>
	);
}
