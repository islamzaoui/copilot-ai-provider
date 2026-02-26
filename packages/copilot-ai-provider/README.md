# copilot-ai-provider

`copilot-ai-provider` connects [GitHub Copilot SDK](https://github.com/github/copilot-sdk) to the [AI SDK](https://ai-sdk.dev).

Use it in two ways:

- **Standalone provider**: direct Copilot client integration (Node.js/Bun runtimes).
- **HTTP provider**: call a hosted adapter service from any runtime.

## Install

```bash
bun add copilot-ai-provider
```

## Quick Start (Standalone)

Use this mode when your code can run a local Copilot SDK client (not browser/edge-only runtimes).

```ts
import { generateText } from "ai";
import { copilotStandalone } from "copilot-ai-provider/client/standalone";

const result = await generateText({
	model: copilotStandalone("gpt-4.1", {
		clientOptions: {
			githubToken: process.env.GITHUB_TOKEN,
		},
	}),
	prompt: "Write a haiku about TypeScript",
});

console.log(result.text);
```

## HTTP Mode

HTTP mode is useful when you want one backend service to handle Copilot sessions and keep GitHub credentials on the server.

### 1) Server

Mount the provided Hono app in your framework:

```ts
import server from "copilot-ai-provider/server";

// Next.js Route Handler
export const GET = server.fetch;
export const POST = server.fetch;
```

Or run it as CLI server:

```bash
GITHUB_TOKEN=your-github-token API_KEY=your-api-key bunx copilot-ai-provider
```

Required server environment variables:

- `GITHUB_TOKEN`: GitHub token used by Copilot SDK.
- `API_KEY`: bearer token required by the HTTP adapter.

Health check endpoint:

- `GET /ping` → `pong`

### 2) Client

```ts
import { generateText } from "ai";
import { copilotHttp } from "copilot-ai-provider/client/http";

const result = await generateText({
	model: copilotHttp("gpt-4.1", {
		http: {
			baseUrl: "http://localhost:3000",
			apiKey: process.env.API_KEY!,
		},
	}),
	prompt: "Explain event loops in one paragraph",
});

console.log(result.text);
```

## Exports

| Entry | Type | Exports |
| --- | --- | --- |
| `copilot-ai-provider/client/standalone` | module | `copilotStandalone(modelId?, options?)`, `createCopilotStandalone(options?)`, `createCopilotStandaloneProvider(options?)` |
| `copilot-ai-provider/client/http` | module | `copilotHttp(modelId?, options)`, `createCopilotHttp(options)`, `createCopilotHttpProvider(options)` |
| `copilot-ai-provider/server` | module | default Hono app instance |
| `copilot-ai-provider` (bin) | executable | `copilot-ai-provider` (run with `bunx copilot-ai-provider`) |

## Model Support

See the GitHub Copilot model catalog:

- https://docs.github.com/en/copilot/reference/ai-models/supported-models
