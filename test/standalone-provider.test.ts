import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { NoSuchModelError } from "@ai-sdk/provider";
import { generateText, Output, stepCountIs, streamText, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import {
	copilotStandalone,
	createCopilotStandaloneProvider,
} from "../src/client/standalone/index.js";

describe("createCopilotStandaloneProvider", () => {
	test("embeddingModel throws NoSuchModelError", () => {
		const provider = createCopilotStandaloneProvider();

		expect(() => provider.embeddingModel("embed-model")).toThrow(NoSuchModelError);
	});

	test("imageModel throws NoSuchModelError", () => {
		const provider = createCopilotStandaloneProvider();

		expect(() => provider.imageModel("image-model")).toThrow(NoSuchModelError);
	});
});

const shouldRunCopilotIntegration = process.env.COPILOT_INTEGRATION !== "0";
const maybeDescribe = shouldRunCopilotIntegration ? describe : describe.skip;
const modelId = process.env.COPILOT_MODEL ?? "gpt-4.1";
const githubToken = process.env.GITHUB_TOKEN;
const model = copilotStandalone(modelId, {
	clientOptions: githubToken ? { githubToken } : undefined,
});

setDefaultTimeout(120_000);

maybeDescribe("copilot standalone integration", () => {
	test("generateText with system + prompt", async () => {
		const result = await generateText({
			model,
			system: "Answer with one short sentence.",
			prompt: "What is 2 + 2?",
		});

		expect(typeof result.text).toBe("string");
		expect(result.text.trim().length).toBeGreaterThan(0);
		expect(result.response.modelId).toBe(modelId);
	});

	test("generateText with messages", async () => {
		const result = await generateText({
			model,
			messages: [
				{ role: "system", content: "Be concise." },
				{ role: "user", content: [{ type: "text", text: "Say hello in two words." }] },
			],
		});

		expect(typeof result.text).toBe("string");
		expect(result.text.trim().length).toBeGreaterThan(0);
		expect(result.response.modelId).toBe(modelId);
	});

	test("generateText with Output.object returns parsed object", async () => {
		const schema = z.object({
			language: z.string(),
		});

		const result = await generateText({
			model,
			output: Output.object({ schema }),
			prompt: 'Return a JSON object with exactly one field: {"language":"TypeScript"}.',
		});

		expect(result.output.language.length).toBeGreaterThan(0);
	});

	test("streamText streams and completes", async () => {
		const result = streamText({
			model,
			prompt: "Count from 1 to 3 in one line.",
		});

		const fullText = await result.text;
		expect(typeof fullText).toBe("string");
		expect(fullText.trim().length).toBeGreaterThan(0);

		const final = await result.finishReason;
		expect(typeof final).toBe("string");
	});

	test("generateText with tools exposes compatibility warning", async () => {
		const result = await generateText({
			model,
			prompt: "Use the lookupWeather tool to get weather for Paris.",
			tools: {
				lookupWeather: tool({
					description: "Lookup weather for a city",
					inputSchema: z.object({ city: z.string() }),
					execute: async ({ city }) => ({ city, forecast: "sunny" }),
				}),
			},
			stopWhen: stepCountIs(2),
		});

		expect(Array.isArray(result.warnings)).toBeTrue();
		expect(
			result.warnings?.some(
				(warning) =>
					warning.type === "compatibility" &&
					"feature" in warning &&
					warning.feature === "client-tools"
			)
		).toBeTrue();
	});

	test("ToolLoopAgent generate smoke test", async () => {
		const agent = new ToolLoopAgent({
			model,
			tools: {
				lookupWeather: tool({
					description: "Return deterministic weather",
					inputSchema: z.object({ city: z.string() }),
					execute: async ({ city }) => ({ city, forecast: "sunny" }),
				}),
			},
			stopWhen: stepCountIs(2),
		});

		const result = await agent.generate({
			prompt: "What is the weather in Lisbon?",
		});

		expect(typeof result.text).toBe("string");
		expect(result.text.trim().length).toBeGreaterThan(0);
	});
});
