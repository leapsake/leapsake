import fs from 'fs/promises';
import path from 'path';
import { redirect } from 'next/navigation';
import * as photosDb from '@/db/photos';

export async function browsePhotos() {
	const photos = await photosDb.browsePhotos();
	return photos;
}

export async function readPhoto(photoId: string) {
	const photo = await photosDb.readPhoto(photoId);
	return photo;
}

export async function addPhotos(formData: FormData) {
	'use server'

	const photos = formData.getAll('photos');
	const uploadDir = path.resolve('public/files/photos');

	try {
		await fs.access(uploadDir, fs.constants.F_OK);
	} catch {
		try {
			await fs.mkdir(uploadDir, { recursive: true });
		} catch (err) {
			console.error(err);
		}
	}

	await Promise.all(photos.map(async (photo) => {
		const buffer = Buffer.from(await photo.arrayBuffer());
		const absolutePath = path.resolve(uploadDir, photo.name);
		const relativePath = path.resolve('/files/photos/', photo.name);

		await fs.writeFile(
			absolutePath,
			buffer
		);

		await photosDb.addPhoto(relativePath);
	}));

	redirect(`/photos`);
}
