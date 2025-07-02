import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	experimental: {
		serverActions: {
			bodySizeLimit: '1gb',
		},
	},
	output: 'standalone',
};

export default nextConfig;