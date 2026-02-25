import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import type { CopilotClientOptions, SessionConfig } from "@github/copilot-sdk";

export type CopilotHttpOptions = {
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
};

export type CopilotProviderOptions = {
	providerId?: string;
	transport?: "local" | "http";
	clientOptions?: CopilotClientOptions;
	sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
	http?: CopilotHttpOptions;
};

export type CopilotCallOptions = {
	model?: string;
	reasoningEffort?: SessionConfig["reasoningEffort"];
	workingDirectory?: string;
	systemMessage?: SessionConfig["systemMessage"];
};

export type CopilotProvider = ProviderV3 & ((modelId?: string) => LanguageModelV3);
