import { defineConfig } from "bunup";

export default defineConfig([
	{
		name: "copilot-ai-provider-client-http",
		entry: "./src/client/http/index.ts",
		outDir: "./dist/client/http",
		target: "browser",
		format: "esm",
		dts: true,
		clean: true,
	},
	{
		name: "copilot-ai-provider-client-standalone",
		entry: "./src/client/standalone/index.ts",
		outDir: "./dist/client/standalone",
		target: "node",
		format: "esm",
		dts: true,
		clean: true,
	},
	{
		name: "copilot-ai-provider-server",
		entry: "./src/server/index.ts",
		outDir: "./dist/server",
		target: "node",
		format: "esm",
		dts: false,
		clean: true,
	},
]);
