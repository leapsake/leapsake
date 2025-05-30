import type { Metadata } from 'next'
import Image from '@/components/Image'
import { deletePhoto, readPhoto } from '@/actions';
import { getPageTitle } from '@/utils';
import Form from '@/components/Form';
import Page from '@/components/Page';
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';

type Props = {
	params: Promise<{ photoId: string }>
}

export async function generateMetadata(): Promise<Metadata> {
	return {
		title: getPageTitle(`Delete photo`),
	};
}

export default async function DeletePersonPage({ params }: Props) {
	const { photoId } = await params;
	const photo = await readPhoto(photoId) as Photo;

	return (
		<Page
			title={`Delete photo?`}
		>
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

			<Form
				action={deletePhoto.bind(null, photoId)}
				submitButtonContent="Delete"
				submitButtonVariant="danger"
			/>
		</Page>
	);
}
