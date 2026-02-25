import { describe, expect, test } from "bun:test";
import { NoSuchModelError } from "@ai-sdk/provider";
import { createCopilotHttpProvider } from "./http/index.js";
import { createCopilotProvider } from "./index.js";

describe("createCopilotProvider", () => {
	test("embeddingModel throws NoSuchModelError", () => {
		const provider = createCopilotProvider();

		expect(() => provider.embeddingModel("embed-model")).toThrow(NoSuchModelError);
	});

	test("imageModel throws NoSuchModelError", () => {
		const provider = createCopilotProvider();

		expect(() => provider.imageModel("image-model")).toThrow(NoSuchModelError);
	});

	test("http transport mode requires baseUrl", () => {
		expect(() =>
			createCopilotProvider({
				transport: "http",
			})
		).not.toThrow();

		const provider = createCopilotProvider({
			transport: "http",
		});

		expect(() => provider.languageModel("gpt-4.1")).toThrow(
			"Copilot HTTP transport requires options.http.baseUrl."
		);
	});
});

describe("createCopilotHttpProvider", () => {
	test("creates an HTTP language model", () => {
		const provider = createCopilotHttpProvider({
			http: {
				baseUrl: "http://localhost:8787",
			},
		});

		expect(() => provider.languageModel("gpt-4.1")).not.toThrow();
	});
});
