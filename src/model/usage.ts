import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import type { SessionEvent } from "@github/copilot-sdk";

export function mergeUsageFromEvent(
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

export function normalizeUsage(usage: Partial<LanguageModelV3Usage>): LanguageModelV3Usage {
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
