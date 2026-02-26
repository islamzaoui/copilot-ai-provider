import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { SessionConfig } from "@github/copilot-sdk";
import type { CopilotCallOptions } from "../lib/types.js";

export function getCopilotCallOptions(options: LanguageModelV3CallOptions): CopilotCallOptions {
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
