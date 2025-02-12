import Link from 'next/link';
import Image from 'next/image';
import styles from './ThumbnailGallery.module.css';

interface Thumbnail {
	id: string;
	path: string;
}

type Props = {
	thumbnails: Thumbnail[];
}

export default async function ThumbnailGallery({ thumbnails }: Props) {
	return (
		<ul className={styles.list}>
			{thumbnails.map((thumbnail) => (
				<li
					className={styles.item}
					key={thumbnail.id}
				>
					<Link
						className={styles.link}
						href={`/photos/${thumbnail.id}`}
					>
						<Image
							alt=""
							height={300}
							width={300}
							src={thumbnail.path}
						/>
					</Link>
				</li>
			))}
		</ul>
	);
}
