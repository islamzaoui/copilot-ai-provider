import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";

export function getWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
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
