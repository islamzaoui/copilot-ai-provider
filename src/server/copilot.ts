import { CopilotClient } from "@github/copilot-sdk";
import { env } from "./env";

class CopilotClientSingleton {
	private static instance: CopilotClientSingleton | undefined;
	private client: CopilotClient | undefined;
	private clientStartPromise: Promise<CopilotClient> | undefined;

	private constructor() {}

	public static getInstance(): CopilotClientSingleton {
		if (!CopilotClientSingleton.instance) {
			CopilotClientSingleton.instance = new CopilotClientSingleton();
		}

		return CopilotClientSingleton.instance;
	}

	public async getClient(): Promise<CopilotClient> {
		if (this.client) {
			return this.client;
		}

		if (!this.clientStartPromise) {
			this.clientStartPromise = (async () => {
				const started = new CopilotClient({
					githubToken: env.GITHUB_TOKEN,
				});
				await started.start();
				this.client = started;
				return started;
			})();
		}

		try {
			return await this.clientStartPromise;
		} catch (error) {
			this.clientStartPromise = undefined;
			throw error;
		}
	}
}

export const getClient = async (): Promise<CopilotClient> => {
	return CopilotClientSingleton.getInstance().getClient();
};
