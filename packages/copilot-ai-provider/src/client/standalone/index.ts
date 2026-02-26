import { type LanguageModelV3, NoSuchModelError, type ProviderV3 } from "@ai-sdk/provider";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from "../../lib/constants.js";
import type { CopilotProvider, CopilotProviderOptions } from "../../lib/types.js";
import { CopilotLanguageModel } from "./CopilotLanguageModel.js";

/**
 * Callable AI SDK provider returned by {@link createCopilotStandalone}.
 *
 * Acts both as:
 * - a function (`provider(modelId?)`) that returns a language model, and
 * - a `ProviderV3` instance (`provider.languageModel(...)`, etc.).
 */
/**
 * Configuration for standalone Copilot client adapters.
 *
 * Use this to configure provider id, SDK client options, and per-session behavior.
 */
export type { CopilotProvider, CopilotProviderOptions } from "../../lib/types.js";

/**
 * Creates a `ProviderV3` adapter backed by the standalone Copilot SDK client.
 *
 * The provider supports language models only. Embedding and image model requests
 * throw `NoSuchModelError`.
 *
 * @param options Provider configuration. Defaults to an empty object.
 * @returns A `ProviderV3` compatible provider instance.
 *
 * @example
 * import { createCopilotStandaloneProvider } from "copilot-ai-provider/client/standalone";
 *
 * const provider = createCopilotStandaloneProvider({
 *   providerId: "copilot",
 * });
 *
 * const model = provider.languageModel("gpt-4.1");
 */
export function createCopilotStandaloneProvider(options: CopilotProviderOptions = {}): ProviderV3 {
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

/**
 * Creates a callable standalone provider.
 *
 * The returned value can be called directly (`provider(modelId?)`) and also
 * exposes the `ProviderV3` methods.
 *
 * @param options Provider configuration. Defaults to an empty object.
 * @returns A callable `CopilotProvider`.
 *
 * @example
 * import { createCopilotStandalone } from "copilot-ai-provider/client/standalone";
 *
 * const copilot = createCopilotStandalone({
 *   providerId: "copilot",
 * });
 *
 * const model = copilot("gpt-4.1");
 */
export function createCopilotStandalone(options: CopilotProviderOptions = {}): CopilotProvider {
	const provider = createCopilotStandaloneProvider(options);

	const callable = Object.assign((modelId = DEFAULT_MODEL_ID) => {
		return provider.languageModel(modelId);
	}, provider) as CopilotProvider;

	return callable;
}

/**
 * Convenience helper that creates a standalone provider and returns one model.
 *
 * Use this for one-off model creation without keeping a provider instance.
 *
 * @param modelId AI model id. Defaults to the package default model id.
 * @param options Provider configuration.
 * @returns A `LanguageModelV3` instance for the requested model.
 *
 * @example
 * import { copilotStandalone } from "copilot-ai-provider/client/standalone";
 *
 * const model = copilotStandalone("gpt-4.1", {
 *   providerId: "copilot",
 * });
 */
export function copilotStandalone(
	modelId: string = DEFAULT_MODEL_ID,
	options?: CopilotProviderOptions
): LanguageModelV3 {
	return createCopilotStandalone(options)(modelId);
}
