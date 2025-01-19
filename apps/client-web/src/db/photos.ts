import fs from 'fs/promises';
import path from 'path';
import { redirect } from 'next/navigation';

export async function addPhotos(formData: FormData) {
	'use server'

	const photos = formData.getAll('photos');
	const uploadDir = path.resolve('data/files/photos');

	try {
		await fs.access(uploadDir, fs.constants.F_OK)
	} catch {
		try {
			await fs.mkdir(uploadDir, { recursive: true });		
		} catch (err) {
			console.error(err);
		}
	}

	await Promise.all(photos.map(async (photo) => {
		const buffer = Buffer.from(await photo.arrayBuffer());

		return fs.writeFile(
			path.resolve(uploadDir, photo.name),
			buffer,
		);
	}));

	redirect(`/photos`);
}
