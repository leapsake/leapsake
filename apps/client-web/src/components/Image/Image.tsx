import { default as NextImage } from 'next/image';

interface Props {
	alt: string;
	height: number;
	width: number;
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
		<NextImage
			{...rest}
			alt={alt}
			height={height}
			width={width}
			src={src}
		/>
	);
}
