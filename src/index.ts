import {
	type LanguageModelV3,
	type LanguageModelV3CallOptions,
	type LanguageModelV3Content,
	type LanguageModelV3FinishReason,
	type LanguageModelV3GenerateResult,
	type LanguageModelV3StreamPart,
	type LanguageModelV3StreamResult,
	type LanguageModelV3Usage,
	NoSuchModelError,
	type ProviderV3,
	type SharedV3Warning,
} from "@ai-sdk/provider";
import {
	CopilotClient,
	type CopilotClientOptions,
	type SessionConfig,
	type SessionEvent,
} from "@github/copilot-sdk";

export type CopilotProviderOptions = {
	providerId?: string;
	clientOptions?: CopilotClientOptions;
	sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
};

type CopilotCallOptions = {
	model?: string;
	reasoningEffort?: SessionConfig["reasoningEffort"];
	workingDirectory?: string;
	systemMessage?: SessionConfig["systemMessage"];
};

const DEFAULT_PROVIDER_ID = "copilot";
const DEFAULT_MODEL_ID = "gpt-4.1";

export type CopilotProvider = ProviderV3 & ((modelId?: string) => LanguageModelV3);

export function createCopilotProvider(options: CopilotProviderOptions = {}): ProviderV3 {
	const providerId = options.providerId ?? DEFAULT_PROVIDER_ID;

	return {
		specificationVersion: "v3",
		languageModel(modelId: string) {
			return new CopilotLanguageModel({
				providerId,
				modelId,
				clientOptions: options.clientOptions,
				sessionConfig: options.sessionConfig,
			});
		},
		embeddingModel(modelId: string) {
			throw new NoSuchModelError({
				modelId,
				modelType: "embeddingModel",
				message: "Copilot provider does not support embeddings in this adapter yet.",
			});
		},
		imageModel(modelId: string) {
			throw new NoSuchModelError({
				modelId,
				modelType: "imageModel",
				message: "Copilot provider does not support image generation in this adapter yet.",
			});
		},
	};
}

export function createCopilot(options: CopilotProviderOptions = {}): CopilotProvider {
	const provider = createCopilotProvider(options);

	const callable = Object.assign((modelId = DEFAULT_MODEL_ID) => {
		return provider.languageModel(modelId);
	}, provider) as CopilotProvider;

	return callable;
}

class CopilotLanguageModel implements LanguageModelV3 {
	readonly specificationVersion = "v3" as const;
	readonly supportedUrls: Record<string, RegExp[]> = {};

	readonly provider: string;
	readonly modelId: string;

	private readonly clientOptions?: CopilotClientOptions;
	private readonly sessionConfig?: Omit<SessionConfig, "model" | "streaming">;

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

	async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
		const warnings = getWarnings(options);
		const callOptions = getCopilotCallOptions(options);

		const client = new CopilotClient(this.clientOptions);
		await client.start();

		const usageAccumulator: Partial<LanguageModelV3Usage> = {};
		let latestTimestamp: Date | undefined;

		try {
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
		} finally {
			await client.stop();
		}
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

			if (client) {
				await client.stop();
			}
		};

		const stream = new ReadableStream<LanguageModelV3StreamPart>({
			start: async (controller) => {
				controller.enqueue({
					type: "stream-start",
					warnings,
				});

				try {
					client = new CopilotClient(this.clientOptions);
					await client.start();

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

				await client.stop();
			},
		});

		return {
			stream,
			response: {},
		};
	}
}

function handleStreamEvent(args: {
	event: SessionEvent;
	controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
	state: {
		textStarted: boolean;
		reasoningStarted: boolean;
		textId: string;
		reasoningId: string;
	};
	usageAccumulator: Partial<LanguageModelV3Usage>;
	onResponseMeta: (timestamp: Date) => void;
	onError: (error: unknown) => Promise<void>;
	onIdle: () => Promise<void>;
}) {
	const { event, controller, state, usageAccumulator, onResponseMeta, onError, onIdle } = args;

	if (event.type === "assistant.message_delta") {
		state.textId = event.data.messageId;
		if (!state.textStarted) {
			controller.enqueue({ type: "text-start", id: state.textId });
			state.textStarted = true;
		}

		if (event.data.deltaContent) {
			controller.enqueue({
				type: "text-delta",
				id: state.textId,
				delta: event.data.deltaContent,
			});
		}

		onResponseMeta(new Date(event.timestamp));
		return;
	}

	if (event.type === "assistant.reasoning_delta") {
		state.reasoningId = event.data.reasoningId;
		if (!state.reasoningStarted) {
			controller.enqueue({ type: "reasoning-start", id: state.reasoningId });
			state.reasoningStarted = true;
		}

		if (event.data.deltaContent) {
			controller.enqueue({
				type: "reasoning-delta",
				id: state.reasoningId,
				delta: event.data.deltaContent,
			});
		}

		onResponseMeta(new Date(event.timestamp));
		return;
	}

	if (event.type === "assistant.reasoning" && event.data.content) {
		state.reasoningId = event.data.reasoningId;
		if (!state.reasoningStarted) {
			controller.enqueue({ type: "reasoning-start", id: state.reasoningId });
			state.reasoningStarted = true;
		}

		controller.enqueue({
			type: "reasoning-delta",
			id: state.reasoningId,
			delta: event.data.content,
		});

		onResponseMeta(new Date(event.timestamp));
		return;
	}

	if (event.type === "assistant.message") {
		state.textId = event.data.messageId;
		if (event.data.content && !state.textStarted) {
			controller.enqueue({ type: "text-start", id: state.textId });
			state.textStarted = true;
			controller.enqueue({
				type: "text-delta",
				id: state.textId,
				delta: event.data.content,
			});
		}

		if (event.data.toolRequests) {
			for (const toolRequest of event.data.toolRequests) {
				controller.enqueue({
					type: "tool-call",
					toolCallId: toolRequest.toolCallId,
					toolName: toolRequest.name,
					input: safeJSONStringify(toolRequest.arguments ?? {}),
					providerExecuted: false,
				});
			}
		}

		onResponseMeta(new Date(event.timestamp));
		return;
	}

	if (event.type === "tool.execution_start") {
		controller.enqueue({
			type: "tool-input-start",
			id: event.data.toolCallId,
			toolName: event.data.toolName,
			providerExecuted: true,
		});
		controller.enqueue({
			type: "tool-input-delta",
			id: event.data.toolCallId,
			delta: safeJSONStringify(event.data.arguments ?? {}),
		});
		controller.enqueue({
			type: "tool-input-end",
			id: event.data.toolCallId,
		});
		return;
	}

	if (event.type === "tool.execution_complete") {
		controller.enqueue({
			type: "tool-result",
			toolCallId: event.data.toolCallId,
			toolName: event.data.parentToolCallId ?? "copilot.tool",
			result:
				event.data.result?.detailedContent ??
				event.data.result?.content ??
				event.data.error?.message ??
				"",
			isError: !event.data.success,
			providerMetadata: {
				copilot: {
					success: event.data.success,
				},
			},
		});
		return;
	}

	if (event.type === "assistant.usage") {
		mergeUsageFromEvent(usageAccumulator, event);
		return;
	}

	if (event.type === "session.error") {
		void onError(new Error(event.data.message));
		return;
	}

	if (event.type === "session.idle") {
		void onIdle();
	}
}

function mapAssistantMessageToContent(
	data:
		| {
				content: string;
				reasoningText?: string;
				toolRequests?: Array<{ toolCallId: string; name: string; arguments?: unknown }>;
		  }
		| undefined
): LanguageModelV3Content[] {
	const content: LanguageModelV3Content[] = [];

	if (!data) {
		return content;
	}

	if (data.reasoningText) {
		content.push({ type: "reasoning", text: data.reasoningText });
	}

	if (data.content) {
		content.push({ type: "text", text: data.content });
	}

	if (data.toolRequests) {
		for (const toolRequest of data.toolRequests) {
			content.push({
				type: "tool-call",
				toolCallId: toolRequest.toolCallId,
				toolName: toolRequest.name,
				input: safeJSONStringify(toolRequest.arguments ?? {}),
			});
		}
	}

	return content;
}

function promptToString(prompt: LanguageModelV3CallOptions["prompt"]): string {
	const lines: string[] = [];

	for (const message of prompt) {
		switch (message.role) {
			case "system": {
				lines.push(`System: ${message.content}`);
				break;
			}
			case "user": {
				lines.push(`User: ${partsToString(message.content)}`);
				break;
			}
			case "assistant": {
				lines.push(`Assistant: ${partsToString(message.content)}`);
				break;
			}
			case "tool": {
				lines.push(`Tool: ${partsToString(message.content)}`);
				break;
			}
		}
	}

	if (lines.length === 0) {
		return "";
	}

	return lines.join("\n\n");
}

function partsToString(
	parts: ReadonlyArray<
		| { type: "text"; text: string }
		| { type: "reasoning"; text: string }
		| { type: "file"; mediaType: string; filename?: string; data?: Uint8Array | string | URL }
		| { type: "tool-call"; toolName: string; toolCallId: string; input: unknown }
		| { type: "tool-result"; toolName: string; toolCallId: string; output: unknown }
		| { type: "tool-approval-response"; approvalId: string; approved: boolean }
	>
): string {
	const mapped = parts.map((part) => {
		switch (part.type) {
			case "text":
			case "reasoning":
				return part.text;
			case "file": {
				const header = `[file:${part.mediaType}${part.filename ? `:${part.filename}` : ""}]`;
				const fileContent = filePartToInlineText(part);
				return fileContent ? `${header}\n${fileContent}` : header;
			}
			case "tool-call":
				return `[tool-call:${part.toolName} id=${part.toolCallId} input=${safeJSONStringify(part.input)}]`;
			case "tool-result":
				return `[tool-result:${part.toolName} id=${part.toolCallId} output=${safeJSONStringify(part.output)}]`;
			case "tool-approval-response":
				return `[tool-approval id=${part.approvalId} approved=${String(part.approved)}]`;
		}

		return "";
	});

	return mapped.join("\n");
}

function filePartToInlineText(part: {
	mediaType: string;
	filename?: string;
	data?: Uint8Array | string | URL;
}): string | undefined {
	if (part.data == null || !isTextLikeFile(part.mediaType, part.filename)) {
		return undefined;
	}

	if (typeof part.data === "string") {
		return part.data;
	}

	if (part.data instanceof Uint8Array) {
		return new TextDecoder().decode(part.data);
	}

	if (part.data instanceof URL) {
		return part.data.toString();
	}

	return undefined;
}

function isTextLikeFile(mediaType: string, filename?: string): boolean {
	const normalizedMediaType = mediaType.toLowerCase();
	if (
		normalizedMediaType.startsWith("text/") ||
		normalizedMediaType.includes("json") ||
		normalizedMediaType.includes("xml") ||
		normalizedMediaType.includes("yaml") ||
		normalizedMediaType.includes("javascript")
	) {
		return true;
	}

	if (!filename) {
		return false;
	}

	const normalizedFilename = filename.toLowerCase();
	return (
		normalizedFilename.endsWith(".json") ||
		normalizedFilename.endsWith(".txt") ||
		normalizedFilename.endsWith(".md") ||
		normalizedFilename.endsWith(".yaml") ||
		normalizedFilename.endsWith(".yml")
	);
}

function getWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
	const warnings: SharedV3Warning[] = [];

	if (options.tools && options.tools.length > 0) {
		warnings.push({
			type: "compatibility",
			feature: "client-tools",
			details:
				"AI SDK client tool execution is partially supported in this adapter. Tool requests are surfaced when available, but direct tool schema forwarding to Copilot is not enabled yet.",
		});
	}

	if (options.responseFormat?.type === "json") {
		warnings.push({
			type: "compatibility",
			feature: "responseFormat.json",
			details: "Copilot SDK does not provide strict JSON mode guarantees in this adapter.",
		});
	}

	return warnings;
}

function getCopilotCallOptions(options: LanguageModelV3CallOptions): CopilotCallOptions {
	const fromProvider = options.providerOptions?.copilot;
	if (!fromProvider || typeof fromProvider !== "object") {
		return {};
	}

	const candidate = fromProvider as Record<string, unknown>;

	return {
		model: typeof candidate.model === "string" ? candidate.model : undefined,
		reasoningEffort:
			candidate.reasoningEffort === "low" ||
			candidate.reasoningEffort === "medium" ||
			candidate.reasoningEffort === "high" ||
			candidate.reasoningEffort === "xhigh"
				? candidate.reasoningEffort
				: undefined,
		workingDirectory:
			typeof candidate.workingDirectory === "string" ? candidate.workingDirectory : undefined,
		systemMessage: parseSystemMessage(candidate.systemMessage),
	};
}

function parseSystemMessage(value: unknown): SessionConfig["systemMessage"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const systemMessage = value as Record<string, unknown>;
	if (systemMessage.mode === "replace" && typeof systemMessage.content === "string") {
		return {
			mode: "replace",
			content: systemMessage.content,
		};
	}

	if (typeof systemMessage.content === "string") {
		return {
			mode: "append",
			content: systemMessage.content,
		};
	}

	return undefined;
}

function mergeUsageFromEvent(
	usageAccumulator: Partial<LanguageModelV3Usage>,
	event: Extract<SessionEvent, { type: "assistant.usage" }>
) {
	usageAccumulator.inputTokens = {
		total: event.data.inputTokens,
		noCache: event.data.inputTokens,
		cacheRead: event.data.cacheReadTokens,
		cacheWrite: event.data.cacheWriteTokens,
	};

	usageAccumulator.outputTokens = {
		total: event.data.outputTokens,
		text: event.data.outputTokens,
		reasoning: undefined,
	};

	usageAccumulator.raw = {
		model: event.data.model,
		cost: event.data.cost,
		duration: event.data.duration,
	};
}

function normalizeUsage(usage: Partial<LanguageModelV3Usage>): LanguageModelV3Usage {
	return {
		inputTokens: {
			total: usage.inputTokens?.total,
			noCache: usage.inputTokens?.noCache,
			cacheRead: usage.inputTokens?.cacheRead,
			cacheWrite: usage.inputTokens?.cacheWrite,
		},
		outputTokens: {
			total: usage.outputTokens?.total,
			text: usage.outputTokens?.text,
			reasoning: usage.outputTokens?.reasoning,
		},
		raw: usage.raw,
	};
}

function safeJSONStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}

export function copilot(
	modelId = DEFAULT_MODEL_ID,
	options?: CopilotProviderOptions
): LanguageModelV3 {
	return createCopilot(options)(modelId);
}
