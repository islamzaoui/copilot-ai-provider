import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { copilotStandalone } from "copilot-ai-provider/client/standalone";

export async function POST(req: Request) {
	const { messages }: { messages: UIMessage[] } = await req.json();

	const result = streamText({
		model: copilotStandalone("gpt-4.1", {
			clientOptions: {
				githubToken: process.env.GITHUB_TOKEN,
			},
		}),
		messages: await convertToModelMessages(messages),
	});

	return result.toUIMessageStreamResponse();
}
