import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";
import { env } from "./env";
import { indexRoute } from "./routes/index.route";

export default new Hono()
	.use(logger())
	.use(
		"*",
		bearerAuth({
			token: env.API_KEY,
		})
	)
	.route("/", indexRoute);
