/**
 * Read-only views into Zerion's agent primitives — policies and tokens.
 * Used by the New Basket modal to populate dropdowns when the user wants
 * fine-grained control instead of the auto-fill default.
 */

import { Hono } from "hono";
import { listAgentTokens, listPolicies } from "../../core/zerion.ts";

export const agentRouter = new Hono();

agentRouter.get("/policies", async (c) => {
  try {
    return c.json({ policies: await listPolicies() });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

agentRouter.get("/tokens", async (c) => {
  try {
    return c.json({ tokens: await listAgentTokens() });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});
