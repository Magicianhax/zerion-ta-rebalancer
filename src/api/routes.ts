/**
 * API root — mounts the per-resource routers under /api and runs the
 * bearer-token auth middleware. Routes themselves live in routes/*.ts.
 */

import { Hono } from "hono";
import { requireAuth } from "./auth.ts";
import { agentRouter } from "./routes/agent.ts";
import { basketsRouter } from "./routes/baskets.ts";
import { systemRouter } from "./routes/system.ts";
import { telegramRouter } from "./routes/telegram.ts";
import { walletsRouter } from "./routes/wallets.ts";

const api = new Hono();

// Public routes first (skip auth middleware below)
api.route("/", systemRouter);

// Everything else requires the bearer token
api.use("*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/health" || path === "/api/auth/login" || path === "/api/tokens") {
    await next();
    return;
  }
  return requireAuth(c, next);
});

api.route("/baskets", basketsRouter);
api.route("/wallets", walletsRouter);
api.route("/agent", agentRouter);
api.route("/telegram", telegramRouter);

export { api };
