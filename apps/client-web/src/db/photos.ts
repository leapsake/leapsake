import db from '@/db';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { redirect } from 'next/navigation';

export async function browsePhotos() {
	const query = `
		SELECT *
		FROM Photos
		ORDER BY created_at ASC
	`;

	const photos = await new Promise((resolve, reject) => {
		db.all(query,
			(err, rows) => {
				if (err) {
					reject(err);
				} else {
					resolve(rows);
				}
			}
		);
	});

	return photos;
}

export async function addPhotos(formData: FormData) {
	'use server'

	const photos = formData.getAll('photos');
	const uploadDir = path.resolve('data/files/photos');

	try {
		await fs.access(uploadDir, fs.constants.F_OK);
	} catch {
		try {
			await fs.mkdir(uploadDir, { recursive: true });
		} catch (err) {
			console.error(err);
		}
	}

	const query = `
		INSERT INTO Photos(
			id,
			path
		)
		VALUES(
			?,
			?
		)
	`;

	await Promise.all(photos.map(async (photo) => {
		const buffer = Buffer.from(await photo.arrayBuffer());
		const photoId = uuidv4();
		const photoPath = path.resolve(uploadDir, photo.name);

		return fs.writeFile(
			photoPath,
			buffer,
		).then(() => {
			db.run(query, [
				photoId,
				photoPath
			], (err) => {
				if (err) {
					console.error(err);
				}
			});
		});
	}));


	redirect(`/photos`);
}
