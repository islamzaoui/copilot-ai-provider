import type { LanguageModelV3Content } from "@ai-sdk/provider";
import { safeJSONStringify } from "./json.js";

export function mapAssistantMessageToContent(
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
