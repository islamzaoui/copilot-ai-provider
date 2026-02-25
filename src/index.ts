import { type LanguageModelV3, NoSuchModelError, type ProviderV3 } from "@ai-sdk/provider";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from "./core/constants.js";
import type { CopilotProvider, CopilotProviderOptions } from "./core/types.js";
import { CopilotLanguageModel } from "./model/CopilotLanguageModel.js";

export type { CopilotProvider, CopilotProviderOptions } from "./core/types.js";

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

export function copilot(
	modelId = DEFAULT_MODEL_ID,
	options?: CopilotProviderOptions
): LanguageModelV3 {
	return createCopilot(options)(modelId);
}
