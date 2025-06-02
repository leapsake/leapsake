import { v4 as uuidv4 } from 'uuid';
import db from './init.ts';

export async function getPhotos(req, res) {
	const query = `
		SELECT *
		FROM Photos
		ORDER BY created_at DESC
	`;

	const photos = await new Promise((resolve, reject) => {
		db.all(
			query,
			(err, rows) => {
				if (err) {
					reject(err);
				} else {
					resolve(rows);
				}
			}
		);
	});

	res.json(photos);
}

export async function getPhoto(req, res) {
	const { photoId } = req.params;

	const query = `
		SELECT *
		FROM Photos
		WHERE id = $photoId
	`;

	const photo = await new Promise((resolve, reject) => {
		db.get(
			query,
			{
				$photoId: photoId,
			},
			(err, row) => {
				if (err) {
					reject(err);
				} else {
					resolve(row);
				}
			}
		);
	});

	if(!photo) {
		res.status(404).json({ error: 'Photo not found' });
	}

	res.json(photo);
}

export async function createPhotos(req, res) {
	const photos = req.files;

	const query = `
		INSERT INTO Photos(
			id,
			path
		)
		VALUES(
			$photoId,
			$photoPath
		)
	`;


	const serverURL = process.env.SERVER_URL;

	await Promise.all(photos.map(async (photo) => {
		const photoId = photo.filename.split('.')[0];
		const photoPath = photo.path.replace('data/', serverURL + '/');

		db.run(
			query,
			{
				$photoId: photoId,
				$photoPath: photoPath,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);
	}));

	res.json();
}

export async function updatePhoto(req, res) {
	const { photoId } = req.params;

	const {
		description,
	} = req.body;

	const query = `
		UPDATE Photos
		SET updated_at = datetime('now'),
			description = $description
		WHERE id = $photoId
	`;

	try {
		db.run(
			query,
			{
				$description: description,
				$photoId: photoId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

		res.json(photoId);
	} catch (error) {
		console.log(error);
	}
}

export async function deletePhoto(req, res) {
	const { photoId } = req.params;

	const query = `
		DELETE FROM Photos
		WHERE id = $photoId
	`;

	try {
		db.run(
			query,
			{
				$photoId: photoId,
			},
			(err) => {
				if (err) {
					console.error(err);
				}
			}
		);

		res.json(true);
	} catch (error) {
		console.log(error);
	}

	// TODO: delete photo files
}