import type { CopilotClient } from "@github/copilot-sdk";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { CopilotHttpGenerateRequest, CopilotHttpGenerateResponse } from "@/lib/http-contract";
import { mergeUsageFromEvent, normalizeUsage } from "@/lib/usage";
import { getClient } from "@/server/copilot";

export const v1Route = new Hono()
	.post("/generate", async (c) => {
		const request = (await c.req.json()) as CopilotHttpGenerateRequest;
		const usageAccumulator = {};
		let latestTimestamp: string | undefined;
		let session: Awaited<ReturnType<CopilotClient["createSession"]>> | undefined;

		try {
			const startedClient = await getClient();
			session = await startedClient.createSession({
				model: request.session.model,
				streaming: false,
				reasoningEffort: request.session.reasoningEffort,
				workingDirectory: request.session.workingDirectory,
				systemMessage: request.session.systemMessage,
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
	})
	.post("/stream", async (c) => {
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
					model: request.session.model,
					streaming: true,
					reasoningEffort: request.session.reasoningEffort,
					workingDirectory: request.session.workingDirectory,
					systemMessage: request.session.systemMessage,
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
