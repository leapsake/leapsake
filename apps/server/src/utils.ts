export async function getMimeTypeFromExtension(extension) {
	// https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types
	const mimeTypes = {
		'.apng': 'image/apng',
		'.avif': 'image/avif',
		'.bmp': 'image/bmp',
		'.gif': 'image/gif',
		'.ico': 'image/vnd.microsoft.icon',
		'.jpeg': 'image/jpeg',
		'.jpg': 'image/jpeg',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.tif': 'image/tiff',
		'.tiff': 'image/tiff',
		'.webp': 'image/webp',
	};

	return mimeTypes[extension];
}
