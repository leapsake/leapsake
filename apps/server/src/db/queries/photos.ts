import fs from 'fs';
import Pool from '../pool';

export async function getPhotos(req, res) {
	const pool = new Pool();

	const query = `
		SELECT *
		FROM Photos
		ORDER BY created_at DESC
	`;

	try {
		const result = await pool.query(query);
		pool.end();

		const photos = result.rows;

		res.json(photos);
	} catch (error) {
		console.log(error);
	}
}

export async function getPhoto(req, res) {
	const { photoId } = req.params;
	const pool = new Pool();

	const query = `
		SELECT *
		FROM Photos
		WHERE id = $1
	`;

	try {
		const result = await pool.query(query, [
			photoId,
		]);
		pool.end();

		const photo = result.rows[0];

		if (!photo) {
			res.status(404).json({ error: 'Photo not found' });
		}

		res.json(photo);
	} catch (error) {
		console.log(error);
	}
}

export async function createPhotos(req, res) {
	const photos = req.files;
	const pool = new Pool();
	const serverURL = process.env.NEXT_PUBLIC_API_URL;

	const query = `
		INSERT INTO Photos(
			id,
			path
		)
		VALUES(
			$1,
			$2
		)
	`;

	try {
		await Promise.all(photos.map(async (photo) => {
			fs.chmod(photo.path, 0o644, (error) => {
				if (error) {
					console.log('chmod error:', error);
				}
			});
			const photoId = photo.filename.split('.')[0];
			const photoPath = serverURL + photo.path;

			return pool.query(query, [
				photoId,
				photoPath,
			]);
		}));
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}
}

export async function updatePhoto(req, res) {
	const { photoId } = req.params;
	const pool = new Pool();

	const {
		description,
	} = req.body;

	const query = `
		UPDATE Photos
		SET updated_at = NOW(),
			description = $1
		WHERE id = $2
	`;

	try {
		await pool.query(query, [
			description,
			photoId,
		]);
		pool.end();

		res.json(photoId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePhoto(req, res) {
	const { photoId } = req.params;
	const pool = new Pool();

	const query = `
		DELETE FROM Photos
		WHERE id = $1
	`;

	try {
		await pool.query(query, [
			photoId,
		]);
		pool.end();

		res.json(true);
	} catch (error) {
		console.log(error);
	}

	// TODO: delete photo files
}
