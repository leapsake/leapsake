import Form from '@/components/Form';
import Page from '@/components/Page';
import { addPhotos } from '@/server';

export default async function NewPhotoPage() {
	return (
		<Page
			title="Add Photos & Videos"
		>
			<Form
				action={addPhotos}
				submitButtonContent="Upload"
			>
				<div>
					<input
						accept="image/*,video/*"
						multiple
						name="photos"
						type="file"
					/>
				</div>
			</Form>
		</Page>
	);
}
