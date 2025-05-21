import { default as NextImage } from 'next/image';
import styles from './Image.module.css';

interface Props {
	alt: string;
	height?: number;
	width?: number;
	src: string;
};

export default function Image({
	alt,
	height,
	width,
	src,
	...rest
}: Props) {
	if (!height || !width) {
		return (
			<img
				{...rest}
				alt={alt}
				className={styles.image}
				height={height}
				src={src}
				width={width}
			/>
		);

	}

	return (
		<NextImage
			{...rest}
			alt={alt}
			height={height}
			src={src}
			width={width}
		/>
	);
}
