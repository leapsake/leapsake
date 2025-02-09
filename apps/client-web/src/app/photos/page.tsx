import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { browsePhotos } from '@/server';
import { Photo } from '@/types';

export const metadata: Metadata = {
	title: 'Photos | Leapsake',
}

export default async function BrowsePhotosPage() {
	const photos = await browsePhotos() as Photo[];

	return (
		<Fragment>
			<header>
				<h1>Photos & Videos</h1>

				<ul>
					<li>
						<Link href="/photos/new">
							<span>➕ Add photos</span>
						</Link>
					</li>
				</ul>
			</header>

			<ul>
				{photos.map((photo) => (
					<li key={photo.id}>
						<Link href={`/photos/${photo.id}`}>
							<Image
								alt=""
								height={300}
								width={300}
								src={photo.path}
							/>
						</Link>
					</li>
				))}
			</ul>
		</Fragment>
	);
}
