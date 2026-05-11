/**
 * Read-only views into Zerion's agent primitives — policies and tokens.
 * Used by the New Basket modal to populate dropdowns when the user wants
 * fine-grained control instead of the auto-fill default.
 */

import { Hono } from "hono";
import { z } from "zod";
import { handleChatMessage, resetConversation } from "../../agent/index.ts";
import { listAgentTokens, listPolicies, showPolicy } from "../../core/zerion.ts";

export const agentRouter = new Hono();

/**
 * Voice-chat proxy. The Pi-side voice frontend POSTs each transcript here
 * and reads back the assistant's text reply. Reuses handleChatMessage so
 * Claude Code subscription auth on this box is the only LLM credential
 * needed — the Pi pays nothing per-token.
 *
 * The chat_id namespaces conversation history; voice clients pass a
 * stable id (e.g. "voice-bablu") so successive turns continue the same
 * thread.
 */
const VoiceChatBody = z.object({
  chat_id: z.string().min(1).default("voice"),
  text: z.string().min(1),
});

agentRouter.post("/voice/chat", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = VoiceChatBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: "invalid_payload", issues: parsed.error.issues } },
      400,
    );
  }
  try {
    const reply = await handleChatMessage(parsed.data.chat_id, parsed.data.text);
    return c.json({ text: reply });
  } catch (e: any) {
    return c.json({ error: { code: "chat_failed", message: e.message } }, 500);
  }
});

agentRouter.post("/voice/reset", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const chatId = typeof body?.chat_id === "string" && body.chat_id ? body.chat_id : "voice";
  resetConversation(chatId);
  return c.json({ ok: true });
});

agentRouter.get("/policies", async (c) => {
  try {
    return c.json({ policies: await listPolicies() });
  } catch (e: any) {
    return c.json({ error: { code: "zerion_error", message: e.message } }, 500);
  }
});

agentRouter.get("/policies/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const policy = await showPolicy(id);
    if (!policy) return c.json({ error: { code: "not_found" } }, 404);
    return c.json({ policy });
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
