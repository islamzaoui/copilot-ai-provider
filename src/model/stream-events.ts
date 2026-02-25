import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";
import type { SessionEvent } from "@github/copilot-sdk";
import { safeJSONStringify } from "./json.js";
import { mergeUsageFromEvent } from "./usage.js";

type StreamState = {
	textStarted: boolean;
	reasoningStarted: boolean;
	textId: string;
	reasoningId: string;
};

export function handleStreamEvent(args: {
	event: SessionEvent;
	controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
	state: StreamState;
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
