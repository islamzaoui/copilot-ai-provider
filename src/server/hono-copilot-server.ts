import { CopilotClient, type CopilotClientOptions, type SessionConfig } from "@github/copilot-sdk";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
	CopilotHttpGenerateRequest,
	CopilotHttpGenerateResponse,
} from "../lib/http-contract.js";
import { mergeUsageFromEvent, normalizeUsage } from "../lib/usage.js";

export type CopilotHonoServerOptions = {
	apiKey?: string;
	clientOptions?: CopilotClientOptions;
	sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
};

export function createCopilotHonoServer(options: CopilotHonoServerOptions = {}) {
	const app = new Hono();

	let client: CopilotClient | undefined;
	let clientStartPromise: Promise<CopilotClient> | undefined;

	const getClient = async (): Promise<CopilotClient> => {
		if (client) {
			return client;
		}

		if (!clientStartPromise) {
			clientStartPromise = (async () => {
				const started = new CopilotClient(options.clientOptions);
				await started.start();
				client = started;
				return started;
			})();
		}

		try {
			return await clientStartPromise;
		} catch (error) {
			clientStartPromise = undefined;
			throw error;
		}
	};

	app.use("*", async (c, next) => {
		if (!options.apiKey) {
			await next();
			return;
		}

		const authHeader = c.req.header("authorization") ?? "";
		if (authHeader !== `Bearer ${options.apiKey}`) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		await next();
	});

	app.post("/v1/generate", async (c) => {
		const request = (await c.req.json()) as CopilotHttpGenerateRequest;
		const usageAccumulator = {};
		let latestTimestamp: string | undefined;
		let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;

		try {
			const startedClient = await getClient();
			session = await startedClient.createSession({
				...options.sessionConfig,
				model: request.session.model,
				streaming: false,
				reasoningEffort: request.session.reasoningEffort ?? options.sessionConfig?.reasoningEffort,
				workingDirectory:
					request.session.workingDirectory ?? options.sessionConfig?.workingDirectory,
				systemMessage: request.session.systemMessage ?? options.sessionConfig?.systemMessage,
			});

			session.on((event) => {
				if (event.type === "assistant.usage") {
					mergeUsageFromEvent(usageAccumulator, event);
					latestTimestamp = event.timestamp;
				}

				if (event.type === "assistant.message" && !latestTimestamp) {
					latestTimestamp = event.timestamp;
				}
			});

			const response = await session.sendAndWait({ prompt: request.prompt });

			const body: CopilotHttpGenerateResponse = {
				message: response?.data,
				usage: normalizeUsage(usageAccumulator),
				timestamp: latestTimestamp,
			};

			return c.json(body);
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : "Unexpected server error",
				},
				500
			);
		} finally {
			if (session) {
				try {
					await session.destroy();
				} catch {}
			}
		}
	});

	app.post("/v1/stream", async (c) => {
		const request = (await c.req.json()) as CopilotHttpGenerateRequest;

		return streamSSE(c, async (stream) => {
			let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;
			let completed = false;

			const complete = async () => {
				if (completed) {
					return;
				}

				completed = true;
				if (session) {
					try {
						await session.destroy();
					} catch {}
				}
			};

			try {
				const startedClient = await getClient();
				session = await startedClient.createSession({
					...options.sessionConfig,
					model: request.session.model,
					streaming: true,
					reasoningEffort:
						request.session.reasoningEffort ?? options.sessionConfig?.reasoningEffort,
					workingDirectory:
						request.session.workingDirectory ?? options.sessionConfig?.workingDirectory,
					systemMessage: request.session.systemMessage ?? options.sessionConfig?.systemMessage,
				});

				const finishPromise = new Promise<void>((resolve) => {
					session?.on((event) => {
						void stream.writeSSE({
							event: "session",
							data: JSON.stringify(event),
						});

						if (event.type === "session.idle" || event.type === "session.error") {
							resolve();
						}
					});
				});

				c.req.raw.signal.addEventListener(
					"abort",
					() => {
						void (async () => {
							try {
								await session?.abort();
							} finally {
								await complete();
							}
						})();
					},
					{ once: true }
				);

				await session.send({ prompt: request.prompt });
				await finishPromise;
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unexpected stream error";
				void stream.writeSSE({
					event: "session",
					data: JSON.stringify({
						type: "session.error",
						timestamp: new Date().toISOString(),
						data: { message },
					}),
				});
			} finally {
				await complete();
			}
		});
	});

	return app;
}
