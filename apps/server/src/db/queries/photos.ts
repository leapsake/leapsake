import fs from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { db } from '../connection.js';
import { photos } from '../schema/photos.js';

export async function getPhotos(req, res) {
	try {
		const result = await db
			.select()
			.from(photos)
			.orderBy(desc(photos.createdAt));

		res.json(result);
	} catch (error) {
		console.log(error);
	}
}

export async function getPhoto(req, res) {
	const { photoId } = req.params;

	try {
		const result = await db
			.select()
			.from(photos)
			.where(eq(photos.id, photoId));

		const photo = result[0];

		if (!photo) {
			res.status(404).json({ error: 'Photo not found' });
		}

		res.json(photo);
	} catch (error) {
		console.log(error);
	}
}

export async function createPhotos(req, res) {
	const photoFiles = req.files;
	const serverURL = process.env.NEXT_PUBLIC_API_URL;

	try {
		await Promise.all(photoFiles.map(async (photo) => {
			try {
				await fs.chmod(photo.path, 0o644);
			} catch (error) {
				console.log('chmod error:', error);
			}

			const photoId = photo.filename.split('.')[0];
			const photoPath = serverURL + photo.path;

			return db.insert(photos).values({
				id: photoId,
				path: photoPath,
			});
		}));

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function updatePhoto(req, res) {
	const { photoId } = req.params;

	const {
		description,
	} = req.body;

	try {
		await db
			.update(photos)
			.set({
				updatedAt: new Date(),
				description,
			})
			.where(eq(photos.id, photoId));

		res.json(photoId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePhoto(req, res) {
	const { photoId } = req.params;

	try {
		await db
			.delete(photos)
			.where(eq(photos.id, photoId));

		res.json(true);
	} catch (error) {
		console.log(error);
	}

	// TODO: delete photo files
}
