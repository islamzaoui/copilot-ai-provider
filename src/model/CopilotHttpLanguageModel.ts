import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
	LanguageModelV3FinishReason,
	LanguageModelV3GenerateResult,
	LanguageModelV3StreamPart,
	LanguageModelV3StreamResult,
	LanguageModelV3Usage,
} from "@ai-sdk/provider";
import type { SessionConfig, SessionEvent } from "@github/copilot-sdk";
import type { CopilotHttpOptions } from "../core/types.js";
import { mapAssistantMessageToContent } from "./content.js";
import type {
	CopilotHttpGenerateRequest,
	CopilotHttpGenerateResponse,
	CopilotHttpSessionConfig,
} from "./http-contract.js";
import { getCopilotCallOptions } from "./options.js";
import { promptToString } from "./prompt.js";
import { handleStreamEvent } from "./stream-events.js";
import { normalizeUsage } from "./usage.js";
import { getWarnings } from "./warnings.js";

export class CopilotHttpLanguageModel implements LanguageModelV3 {
	readonly specificationVersion = "v3" as const;
	readonly supportedUrls: Record<string, RegExp[]> = {};

	readonly provider: string;
	readonly modelId: string;

	private readonly httpOptions: CopilotHttpOptions;
	private readonly sessionConfig?: Omit<SessionConfig, "model" | "streaming">;

	constructor(options: {
		providerId: string;
		modelId: string;
		httpOptions: CopilotHttpOptions;
		sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
	}) {
		this.provider = options.providerId;
		this.modelId = options.modelId;
		this.httpOptions = options.httpOptions;
		this.sessionConfig = options.sessionConfig;
	}

	private getEndpoint(pathname: string): string {
		return new URL(pathname, this.httpOptions.baseUrl).toString();
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			...this.httpOptions.headers,
		};

		if (this.httpOptions.apiKey) {
			headers.authorization = `Bearer ${this.httpOptions.apiKey}`;
		}

		return headers;
	}

	private toSessionConfig(options: LanguageModelV3CallOptions): CopilotHttpSessionConfig {
		const callOptions = getCopilotCallOptions(options);
		const selectedSystemMessage = callOptions.systemMessage ?? this.sessionConfig?.systemMessage;
		const systemMessage =
			selectedSystemMessage && typeof selectedSystemMessage.content === "string"
				? {
						mode: selectedSystemMessage.mode ?? "append",
						content: selectedSystemMessage.content,
					}
				: undefined;

		return {
			model: callOptions.model ?? this.modelId,
			reasoningEffort: callOptions.reasoningEffort ?? this.sessionConfig?.reasoningEffort,
			workingDirectory: callOptions.workingDirectory ?? this.sessionConfig?.workingDirectory,
			systemMessage,
		};
	}

	private async readJsonResponse<T>(response: Response): Promise<T> {
		if (!response.ok) {
			const bodyText = await response.text();
			throw new Error(`Copilot HTTP backend error (${response.status}): ${bodyText}`);
		}

		return (await response.json()) as T;
	}

	async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
		const warnings = getWarnings(options);
		const session = this.toSessionConfig(options);

		const payload: CopilotHttpGenerateRequest = {
			prompt: promptToString(options.prompt),
			session,
		};

		const response = await fetch(this.getEndpoint("/v1/generate"), {
			method: "POST",
			headers: this.getHeaders(),
			body: JSON.stringify(payload),
			signal: options.abortSignal,
		});

		const data = await this.readJsonResponse<CopilotHttpGenerateResponse>(response);
		const finishReason: LanguageModelV3FinishReason = {
			unified: data.message?.toolRequests?.length ? "tool-calls" : "stop",
			raw: data.message?.toolRequests?.length ? "tool_requests" : "session.idle",
		};

		return {
			content: mapAssistantMessageToContent(data.message),
			finishReason,
			usage: normalizeUsage((data.usage ?? {}) as Partial<LanguageModelV3Usage>),
			warnings,
			response: {
				timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
				modelId: session.model,
			},
		};
	}

	async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
		const warnings = getWarnings(options);
		const session = this.toSessionConfig(options);

		let streamEnded = false;
		let textStarted = false;
		let reasoningStarted = false;
		let textId = "text-0";
		let reasoningId = "reasoning-0";
		let responseTimestamp: Date | undefined;
		const usageAccumulator: Partial<LanguageModelV3Usage> = {};

		const finish = (
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
		};

		const stream = new ReadableStream<LanguageModelV3StreamPart>({
			start: async (controller) => {
				controller.enqueue({
					type: "stream-start",
					warnings,
				});

				try {
					const response = await fetch(this.getEndpoint("/v1/stream"), {
						method: "POST",
						headers: this.getHeaders(),
						body: JSON.stringify({
							prompt: promptToString(options.prompt),
							session,
						} satisfies CopilotHttpGenerateRequest),
						signal: options.abortSignal,
					});

					if (!response.ok) {
						const bodyText = await response.text();
						throw new Error(`Copilot HTTP backend error (${response.status}): ${bodyText}`);
					}

					if (!response.body) {
						throw new Error("Copilot HTTP backend returned no stream body.");
					}

					for await (const event of iterateSSEEvents(response.body)) {
						if (streamEnded) {
							break;
						}

						const parsed = safeParseJson(event.data);
						if (!parsed) {
							continue;
						}

						handleStreamEvent({
							event: parsed as SessionEvent,
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
										modelId: session.model,
									});
								}
							},
							onError: async (error) => {
								controller.enqueue({ type: "error", error });
								finish(controller, { unified: "error", raw: "session.error" });
							},
							onIdle: async () => {
								finish(controller, { unified: "stop", raw: "session.idle" });
							},
						});
					}

					finish(controller, { unified: "stop", raw: "stream.closed" });
				} catch (error) {
					if (options.abortSignal?.aborted) {
						finish(controller, { unified: "other", raw: "aborted" });
						return;
					}

					controller.enqueue({ type: "error", error });
					finish(controller, { unified: "error", raw: "exception" });
				}
			},
			cancel: async () => {},
		});

		return {
			stream,
			response: {},
		};
	}
}

function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

type SSEEvent = {
	event?: string;
	data: string;
};

async function* iterateSSEEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
	const decoder = new TextDecoder();
	const reader = stream.getReader();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });

			while (true) {
				const boundaryIndex = buffer.indexOf("\n\n");
				if (boundaryIndex < 0) {
					break;
				}

				const block = buffer.slice(0, boundaryIndex);
				buffer = buffer.slice(boundaryIndex + 2);

				const parsed = parseSSEBlock(block);
				if (parsed) {
					yield parsed;
				}
			}
		}

		if (buffer.trim().length > 0) {
			const parsed = parseSSEBlock(buffer);
			if (parsed) {
				yield parsed;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function parseSSEBlock(block: string): SSEEvent | undefined {
	const lines = block.split(/\r?\n/);
	let event: string | undefined;
	const dataLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith(":")) {
			continue;
		}

		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
			continue;
		}

		if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}

	if (dataLines.length === 0) {
		return undefined;
	}

	return {
		event,
		data: dataLines.join("\n"),
	};
}
