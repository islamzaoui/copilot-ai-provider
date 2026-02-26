#!/usr/bin/env node

import { serve } from "@hono/node-server";
import app from "../index";

const server = serve(app, (info) =>
	console.info(`Server is running on http://${info.address}:${info.port}`)
);

const signals = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
	process.on(signal, async () => {
		console.info(`Received ${signal}. Initiating graceful shutdown...`);
		server.close();
		process.exit(0);
	});
}

process.on("uncaughtException", (err) => {
	console.error(err);
});

process.on("unhandledRejection", (err) => {
	console.error(err);
});
