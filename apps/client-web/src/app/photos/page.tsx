import { Fragment } from 'react';
import Link from 'next/link';
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
						<label>
							<span>➕ Add photos</span>
							<input 
								accept="image/*"
								multiple style={{visibility:'hidden'}}
								name="photos" 
								type="file" 
							/>
						</label>
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
