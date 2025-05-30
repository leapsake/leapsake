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
	height,
	width,
	src,
	...rest
}: Props) {
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
