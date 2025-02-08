import db from '@/db';
import { v4 as uuidv4 } from 'uuid';

export async function browsePhotos() {
	const query = `
		SELECT *
		FROM Photos
		ORDER BY created_at ASC
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

	return photos;
}

export async function addPhoto(photoPath: string) {
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

	const photoId = uuidv4();

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

	return photoId;
}
