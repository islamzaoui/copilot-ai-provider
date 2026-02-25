import { createCopilotHonoServer } from "./hono-copilot-server.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);

const app = createCopilotHonoServer({
	apiKey: process.env.COPILOT_HTTP_API_KEY,
	clientOptions: process.env.GITHUB_TOKEN
		? {
				githubToken: process.env.GITHUB_TOKEN,
			}
		: undefined,
});

Bun.serve({
	port,
	fetch: app.fetch,
});

console.log(`Copilot Hono backend listening on :${port}`);
