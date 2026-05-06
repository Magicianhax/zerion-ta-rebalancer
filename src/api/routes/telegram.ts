/**
 * Telegram-related routes:
 *   - POST /pair returns a one-time pairing code for ad-hoc chat registration
 *   - GET  /authorized exposes the env-driven user-ID whitelist (read-only)
 *
 * The whitelist is the source of truth for bot authorization (set via
 * TELEGRAM_AUTHORIZED_USER_IDS in .env). Pairing codes are a fallback for
 * registering chats whose owner isn't on the whitelist.
 */

import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { config } from "../../config.ts";
import { createPairing } from "../../core/db.ts";

export const telegramRouter = new Hono();

telegramRouter.post("/pair", (c) => {
  const code = randomBytes(4).toString("hex");
  createPairing(code, 30);
  return c.json({ pairingCode: code, expiresIn: "30m" });
});

telegramRouter.get("/authorized", (c) => {
  return c.json({ userIds: config.telegramAuthorizedUserIds });
});
