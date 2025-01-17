import { Fragment } from 'react';

export default async function NewPhotoPage() {
	return (
		<Fragment>
			<h1 id="label-photos">Add Photos & Videos</h1>

			<form>
				<div>
					<input
						accept="image/*,video/*"
						aria-labelledby="label-photos"
						multiple
						name="photos"
						type="file"
					/>
				</div>

				<button type="submit">Upload</button>
			</form>
		</Fragment>
	);
}
