import { describe, expect, test } from "bun:test";
import { NoSuchModelError } from "@ai-sdk/provider";
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
});
