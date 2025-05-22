import { default as NextImage } from 'next/image';
import styles from './Image.module.css';

interface Props {
	alt: string;
	fill?: boolean;
	height?: number;
	width?: number;
	src: string;
};

export default function Image({
	alt,
	fill,
	height,
	width,
	src,
	...rest
}: Props) {
	if (height || width || fill) {
		return (
			<NextImage
				{...rest}
				alt={alt}
				fill={fill}
				height={height}
				src={src}
				width={width}
			/>
		);
	}

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
