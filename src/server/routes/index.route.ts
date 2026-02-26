import { Hono } from "hono";
import { v1Route } from "./v1.route";

export const indexRoute = new Hono().route("/v1", v1Route);
