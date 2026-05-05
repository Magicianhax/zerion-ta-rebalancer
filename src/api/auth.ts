/**
 * Bearer-token auth middleware. The admin password from .env doubles as the
 * token — simple by design for self-hosted single-user deployments.
 *
 * For SSE (which can't set headers), pass `?token=...` in the URL.
 */

import type { Context, Next } from "hono";
import { config } from "../config.ts";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function extractToken(c: Context): string | null {
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const queryToken = c.req.query("token");
  if (queryToken) return queryToken;
  return null;
}

export function isAuthenticated(c: Context): boolean {
  const token = extractToken(c);
  if (!token) return false;
  return safeEqual(token, config.adminPassword);
}

export async function requireAuth(c: Context, next: Next) {
  if (!isAuthenticated(c)) {
    return c.json({ error: { code: "unauthorized", message: "Missing or invalid token" } }, 401);
  }
  await next();
}
