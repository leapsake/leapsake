import { Fragment } from 'react';
import Link from 'next/link';
import AutoUploadInput from '@/components/AutoUploadInput';
// import { browsePeople } from '@/db/people';

export default async function BrowsePeoplePage() {
	//const photos = await browsePhotos();
	const photos = [];

	return (
		<Fragment>
			<header>
				<h1>Photos & Videos</h1>

				<ul>
					<li>
						<AutoUploadInput
							accept="image/*"
							multiple={true}
							name="photos"
						>
							<span>➕ Add photos</span>
						</AutoUploadInput>
					</li>
				</ul>
			</header>

			<ul>
				{photos.map((photos) => (
					<li key={photos.id}>
						<Link href={`/photos/${photo.id}`}>Photo</Link>
					</li>
				))}
			</ul>
		</Fragment>
	);
}
