import { type LanguageModelV3, NoSuchModelError, type ProviderV3 } from "@ai-sdk/provider";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from "../../lib/constants.js";
import type { CopilotHttpOptions, CopilotProvider } from "../../lib/types.js";
import { CopilotHttpLanguageModel } from "./CopilotHttpLanguageModel.js";

export type CopilotHttpProviderOptions = {
	providerId?: string;
	http: CopilotHttpOptions;
	sessionConfig?: {
		reasoningEffort?: "low" | "medium" | "high" | "xhigh";
		workingDirectory?: string;
		systemMessage?: {
			mode: "append" | "replace";
			content: string;
		};
	};
};

export function createCopilotHttpProvider(options: CopilotHttpProviderOptions): ProviderV3 {
	const providerId = options.providerId ?? DEFAULT_PROVIDER_ID;

	return {
		specificationVersion: "v3",
		languageModel(modelId: string) {
			return new CopilotHttpLanguageModel({
				providerId,
				modelId,
				httpOptions: options.http,
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

export function createCopilotHttp(options: CopilotHttpProviderOptions): CopilotProvider {
	const provider = createCopilotHttpProvider(options);

	const callable = Object.assign((modelId = DEFAULT_MODEL_ID) => {
		return provider.languageModel(modelId);
	}, provider) as CopilotProvider;

	return callable;
}

export function copilotHttp(
	modelId: string = DEFAULT_MODEL_ID,
	options: CopilotHttpProviderOptions
) {
	return createCopilotHttp(options)(modelId) as LanguageModelV3;
}
