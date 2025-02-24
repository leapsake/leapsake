import { Fragment } from 'react';
import Form from '@/components/Form';
import { addPhotos } from '@/server';

export default async function NewPhotoPage() {
	return (
		<Fragment>
			<h1 id="label-photos">Add Photos & Videos</h1>

			<Form
				action={addPhotos}
				submitButtonContent="Upload"
			>
				<div>
					<input
						accept="image/*,video/*"
						aria-labelledby="label-photos"
						multiple
						name="photos"
						type="file"
					/>
				</div>
			</Form>
		</Fragment>
	);
}
