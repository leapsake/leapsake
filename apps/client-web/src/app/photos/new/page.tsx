import { Fragment } from 'react';
import Button from '@/components/Button';
import { addPhotos } from '@/server';

export default async function NewPhotoPage() {
	return (
		<Fragment>
			<h1 id="label-photos">Add Photos & Videos</h1>

			<form action={addPhotos}>
				<div>
					<input
						accept="image/*,video/*"
						aria-labelledby="label-photos"
						multiple
						name="photos"
						type="file"
					/>
				</div>

				<Button type="submit">Upload</Button>
			</form>
		</Fragment>
	);
}
