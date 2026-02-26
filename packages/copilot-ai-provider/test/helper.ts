import { copilotHttp } from "../dist/client/http";

export async function isServerOnline(baseUrl: string, apiKey: string): Promise<boolean> {
	return fetch(`${baseUrl}/ping`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})
		.then((res) => res.text())
		.then((text) => text === "pong")
		.catch(() => false);
}

export function getHttpModel(baseUrl: string, modelId: string, apiKey: string) {
	return copilotHttp(modelId, {
		http: {
			baseUrl: baseUrl,
			apiKey: apiKey,
		},
	});
}
