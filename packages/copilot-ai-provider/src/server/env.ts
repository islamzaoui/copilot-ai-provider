import z from "zod";

const EnvSchema = z.object({
	API_KEY: z
		.string({
			error: "API_KEY is required and must be a non-empty string",
		})
		.trim(),
	GITHUB_TOKEN: z
		.string({
			error: "GITHUB_TOKEN is required and must be a non-empty string",
		})
		.trim(),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
	console.error("Invalid environment variables:", z.flattenError(result.error).fieldErrors);
	process.exit(1);
}

export const env = result.data;
