import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	reactCompiler: true,
	serverExternalPackages: ["@github/copilot-sdk"],
};

export default nextConfig;
