import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3FinishReason,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3StreamResult,
	LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { CopilotClient, type CopilotClientOptions, type SessionConfig } from "@github/copilot-sdk";
import { mergeUsageFromEvent, normalizeUsage } from "../../lib/usage.js";
import { mapAssistantMessageToContent } from "../content.js";
import { getCopilotCallOptions } from "../options.js";
import { promptToString } from "../prompt.js";
import { handleStreamEvent } from "../stream-events.js";
import { getWarnings } from "../warnings.js";

export class CopilotLanguageModel implements LanguageModelV3 {
	readonly specificationVersion = "v3" as const;
	readonly supportedUrls: Record<string, RegExp[]> = {};

	readonly provider: string;
	readonly modelId: string;

	private readonly clientOptions?: CopilotClientOptions;
	private readonly sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
	private client?: CopilotClient;
	private clientStartPromise?: Promise<CopilotClient>;

	constructor(options: {
		providerId: string;
		modelId: string;
		clientOptions?: CopilotClientOptions;
		sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
	}) {
		this.provider = options.providerId;
		this.modelId = options.modelId;
		this.clientOptions = options.clientOptions;
		this.sessionConfig = options.sessionConfig;
	}

	private async getClient(): Promise<CopilotClient> {
		if (this.client) {
			return this.client;
		}

		if (!this.clientStartPromise) {
			this.clientStartPromise = (async () => {
				const client = new CopilotClient(this.clientOptions);
				await client.start();
				this.client = client;
				return client;
			})();
		}

		try {
			return await this.clientStartPromise;
		} catch (error) {
			this.clientStartPromise = undefined;
			throw error;
		}
	}

	async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
		const warnings = getWarnings(options);
		const callOptions = getCopilotCallOptions(options);

		const client = await this.getClient();

		const usageAccumulator: Partial<LanguageModelV3Usage> = {};
		let latestTimestamp: Date | undefined;

		const session = await client.createSession({
			...this.sessionConfig,
			model: callOptions.model ?? this.modelId,
			streaming: false,
			reasoningEffort: callOptions.reasoningEffort ?? this.sessionConfig?.reasoningEffort,
			workingDirectory: callOptions.workingDirectory ?? this.sessionConfig?.workingDirectory,
			systemMessage: callOptions.systemMessage ?? this.sessionConfig?.systemMessage,
		});

		session.on((event) => {
			if (event.type === "assistant.usage") {
				mergeUsageFromEvent(usageAccumulator, event);
			}
			if (event.type === "assistant.message" || event.type === "assistant.usage") {
				latestTimestamp = new Date(event.timestamp);
			}
		});

		const response = await session.sendAndWait({
			prompt: promptToString(options.prompt),
		});

		const content = mapAssistantMessageToContent(response?.data);
		const finishReason: LanguageModelV3FinishReason = {
			unified: response?.data.toolRequests?.length ? "tool-calls" : "stop",
			raw: response?.data.toolRequests?.length ? "tool_requests" : "session.idle",
		};

		await session.destroy();

		return {
			content,
			finishReason,
			usage: normalizeUsage(usageAccumulator),
			warnings,
			response: {
				timestamp: latestTimestamp,
				modelId: callOptions.model ?? this.modelId,
			},
		};
	}

	async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
		const warnings = getWarnings(options);
		const callOptions = getCopilotCallOptions(options);

		let client: CopilotClient | undefined;
		let sessionId: string | undefined;
		let sessionDestroyed = false;
		let streamEnded = false;

		let textStarted = false;
		let reasoningStarted = false;
		let textId = "text-0";
		let reasoningId = "reasoning-0";
		let responseTimestamp: Date | undefined;
		const usageAccumulator: Partial<LanguageModelV3Usage> = {};

		const finish = async (
			controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
			finishReason: LanguageModelV3FinishReason
		) => {
			if (streamEnded) {
				return;
			}

			if (textStarted) {
				controller.enqueue({ type: "text-end", id: textId });
				textStarted = false;
			}

			if (reasoningStarted) {
				controller.enqueue({ type: "reasoning-end", id: reasoningId });
				reasoningStarted = false;
			}

			controller.enqueue({
				type: "finish",
				finishReason,
				usage: normalizeUsage(usageAccumulator),
			});

			streamEnded = true;
			controller.close();

			if (client && sessionId && !sessionDestroyed) {
				try {
					const resumed = await client.resumeSession(sessionId, { disableResume: true });
					await resumed.destroy();
					sessionDestroyed = true;
				} catch {}
			}
		};

		const stream = new ReadableStream<LanguageModelV3StreamPart>({
			start: async (controller) => {
				controller.enqueue({
					type: "stream-start",
					warnings,
				});

				try {
					client = await this.getClient();

					const session = await client.createSession({
						...this.sessionConfig,
						model: callOptions.model ?? this.modelId,
						streaming: true,
						reasoningEffort: callOptions.reasoningEffort ?? this.sessionConfig?.reasoningEffort,
						workingDirectory: callOptions.workingDirectory ?? this.sessionConfig?.workingDirectory,
						systemMessage: callOptions.systemMessage ?? this.sessionConfig?.systemMessage,
					});

					sessionId = session.sessionId;

					session.on((event) => {
						if (streamEnded) {
							return;
						}

						handleStreamEvent({
							event,
							controller,
							state: {
								get textStarted() {
									return textStarted;
								},
								set textStarted(value: boolean) {
									textStarted = value;
								},
								get reasoningStarted() {
									return reasoningStarted;
								},
								set reasoningStarted(value: boolean) {
									reasoningStarted = value;
								},
								get textId() {
									return textId;
								},
								set textId(value: string) {
									textId = value;
								},
								get reasoningId() {
									return reasoningId;
								},
								set reasoningId(value: string) {
									reasoningId = value;
								},
							},
							usageAccumulator,
							onResponseMeta: (timestamp) => {
								if (!responseTimestamp) {
									responseTimestamp = timestamp;
									controller.enqueue({
										type: "response-metadata",
										timestamp,
										modelId: callOptions.model ?? this.modelId,
									});
								}
							},
							onError: async (error) => {
								controller.enqueue({ type: "error", error });
								await finish(controller, { unified: "error", raw: "session.error" });
							},
							onIdle: async () => {
								await finish(controller, { unified: "stop", raw: "session.idle" });
							},
						});
					});

					if (options.abortSignal) {
						options.abortSignal.addEventListener(
							"abort",
							() => {
								void (async () => {
									try {
										await session.abort();
									} finally {
										await finish(controller, { unified: "other", raw: "aborted" });
									}
								})();
							},
							{ once: true }
						);
					}

					await session.send({
						prompt: promptToString(options.prompt),
					});
				} catch (error) {
					controller.enqueue({ type: "error", error });
					await finish(controller, { unified: "error", raw: "exception" });
				}
			},
			cancel: async () => {
				if (!client) {
					return;
				}

				if (sessionId) {
					try {
						const resumed = await client.resumeSession(sessionId, { disableResume: true });
						await resumed.abort();
						await resumed.destroy();
					} catch {}
				}
			},
		});

		return {
			stream,
			response: {},
		};
	}
}
