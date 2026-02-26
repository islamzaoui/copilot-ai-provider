import { type LanguageModelV3, NoSuchModelError, type ProviderV3 } from "@ai-sdk/provider";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID } from "../../lib/constants.js";
import type { CopilotHttpOptions, CopilotProvider } from "../../lib/types.js";
import { CopilotHttpLanguageModel } from "./CopilotHttpLanguageModel.js";

/**
 * Configuration for the HTTP Copilot provider adapter.
 *
 * @property providerId Optional provider id used in AI SDK metadata.
 * @property http Required HTTP transport configuration.
 * @property sessionConfig Optional per-session behavior configuration.
 * @property sessionConfig.reasoningEffort Optional reasoning effort hint.
 * @property sessionConfig.workingDirectory Optional working directory hint.
 * @property sessionConfig.systemMessage Optional system message behavior.
 */
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

/**
 * Creates a `ProviderV3` adapter that calls a remote Copilot HTTP endpoint.
 *
 * The provider supports language models only. Embedding and image model requests
 * throw `NoSuchModelError`.
 *
 * @param options HTTP provider configuration.
 * @returns A `ProviderV3` compatible provider instance.
 *
 * @example
 * import { createCopilotHttpProvider } from "copilot-ai-provider/client/http";
 *
 * const provider = createCopilotHttpProvider({
 *   http: {
 *     baseUrl: "https://example.com",
 *     apiKey: process.env.COPILOT_API_KEY,
 *   },
 * });
 *
 * const model = provider.languageModel("gpt-4.1");
 */
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

/**
 * Creates a callable HTTP provider.
 *
 * The returned value can be called directly (`provider(modelId?)`) and also
 * exposes the `ProviderV3` methods.
 *
 * @param options HTTP provider configuration.
 * @returns A callable `CopilotProvider`.
 *
 * @example
 * import { createCopilotHttp } from "copilot-ai-provider/client/http";
 *
 * const copilot = createCopilotHttp({
 *   http: {
 *     baseUrl: "https://example.com",
 *     apiKey: process.env.COPILOT_API_KEY,
 *   },
 * });
 *
 * const model = copilot("gpt-4.1");
 */
export function createCopilotHttp(options: CopilotHttpProviderOptions): CopilotProvider {
	const provider = createCopilotHttpProvider(options);

	const callable = Object.assign((modelId = DEFAULT_MODEL_ID) => {
		return provider.languageModel(modelId);
	}, provider) as CopilotProvider;

	return callable;
}

/**
 * Convenience helper that creates an HTTP provider and returns one model.
 *
 * @param modelId AI model id. Defaults to the package default model id.
 * @param options HTTP provider configuration.
 * @returns A `LanguageModelV3` instance for the requested model.
 *
 * @example
 * import { copilotHttp } from "copilot-ai-provider/client/http";
 *
 * const model = copilotHttp("gpt-4.1", {
 *   http: {
 *     baseUrl: "https://example.com",
 *     apiKey: process.env.COPILOT_API_KEY,
 *   },
 * });
 */
export function copilotHttp(
	modelId: string = DEFAULT_MODEL_ID,
	options: CopilotHttpProviderOptions
) {
	return createCopilotHttp(options)(modelId) as LanguageModelV3;
}
