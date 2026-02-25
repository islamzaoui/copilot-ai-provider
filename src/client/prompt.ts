import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { safeJSONStringify } from "./json.js";

export function promptToString(prompt: LanguageModelV3CallOptions["prompt"]): string {
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
