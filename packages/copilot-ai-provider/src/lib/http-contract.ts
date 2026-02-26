export type CopilotHttpSystemMessage = {
	mode: "append" | "replace";
	content: string;
};

export type CopilotHttpSessionConfig = {
	model: string;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	workingDirectory?: string;
	systemMessage?: CopilotHttpSystemMessage;
};

export type CopilotHttpGenerateRequest = {
	prompt: string;
	session: CopilotHttpSessionConfig;
};

export type CopilotHttpGenerateResponse = {
	message?: {
		content: string;
		reasoningText?: string;
		toolRequests?: Array<{
			toolCallId: string;
			name: string;
			arguments?: unknown;
		}>;
	};
	usage?: {
		inputTokens?: {
			total?: number;
			noCache?: number;
			cacheRead?: number;
			cacheWrite?: number;
		};
		outputTokens?: {
			total?: number;
			text?: number;
			reasoning?: number;
		};
		raw?: unknown;
	};
	timestamp?: string;
};
