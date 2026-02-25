import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import type { CopilotClientOptions, SessionConfig } from "@github/copilot-sdk";

export type CopilotProviderOptions = {
	providerId?: string;
	clientOptions?: CopilotClientOptions;
	sessionConfig?: Omit<SessionConfig, "model" | "streaming">;
};

export type CopilotCallOptions = {
	model?: string;
	reasoningEffort?: SessionConfig["reasoningEffort"];
	workingDirectory?: string;
	systemMessage?: SessionConfig["systemMessage"];
};

export type CopilotProvider = ProviderV3 & ((modelId?: string) => LanguageModelV3);
