// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
	base: '/',
	integrations: [preact()],
	site: 'https://leapsake.com',
});
