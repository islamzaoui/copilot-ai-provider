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
