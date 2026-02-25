import type { CopilotProviderOptions } from "../../src/core/types.js";

export function shouldRunCopilotIntegration(): boolean {
	return process.env.COPILOT_INTEGRATION !== "0";
}

export function getCopilotModel(): string {
	return process.env.COPILOT_MODEL ?? "gpt-4.1";
}

export function getCopilotClientOptions(): { githubToken?: string } {
	const githubToken = process.env.GITHUB_TOKEN;
	return githubToken ? { githubToken } : {};
}

export function getCopilotProviderOptions(): CopilotProviderOptions {
	const baseUrl = process.env.COPILOT_HTTP_BASE_URL;
	if (!baseUrl) {
		return {
			clientOptions: getCopilotClientOptions(),
		};
	}

	return {
		transport: "http",
		http: {
			baseUrl,
			apiKey: process.env.COPILOT_HTTP_API_KEY,
		},
	};
}
