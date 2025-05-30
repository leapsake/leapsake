import styles from './ThumbnailGallery.module.css';
import Image from '@/components/Image';
import Link from '@/components/Link';

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
				<Thumbnail
					key={thumbnail.id}
					thumbnail={thumbnail} />
			))}
		</ul>
	);
}

function Thumbnail({ thumbnail }: { thumbnail: Thumbnail }) {
	return (
		<li
			className={styles.item}
			key={thumbnail.id}
		>
			<Link
				className={styles.link}
				href={`/photos/${thumbnail.id}`}
			>
				<figure className={styles.figure}>
					<Image
						alt=""
						src={thumbnail.path}
					/>
				</figure>
				<div className={styles.overlay}>
				</div>
			</Link>
		</li>

	);
}
