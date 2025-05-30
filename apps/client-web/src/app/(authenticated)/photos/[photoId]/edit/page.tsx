import type { Metadata } from 'next';
import Image from '@/components/Image';
import TextArea from '@/components/TextArea';
import { editPhoto, readPhoto } from '@/actions';
import { getPageTitle } from '@/utils';
import Form from '@/components/Form';
import Page from '@/components/Page';
import CreatedUpdatedMetadata from '@/components/CreatedUpdatedMetadata';

type Props = {
	params: Promise<{ photoId: string }>
}

export async function generateMetadata(): Promise<Metadata> {
	return {
		title: getPageTitle('Edit photo'),
	};
}

export default async function EditPhotoPage({ params }: Props) {
	const { photoId } = await params;
	const photo = await readPhoto(photoId) as Photo;

	return (
		<Page
			title="Edit photo"
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
				action={editPhoto.bind(null, photoId)}
				submitButtonContent="Save changes"
			>
				<TextArea 
					defaultValue={photo.description} 
					label="Description"
					name="description" 
				/>
			</Form>
		</Page>
	);
}
