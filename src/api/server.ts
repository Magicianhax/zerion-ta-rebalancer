/**
 * Hono HTTP server: mounts /api/* routes and serves the built React SPA from
 * web/dist with index.html fallback for client-side routing.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { config } from "../config.ts";
import { api } from "./routes.ts";

const WEB_DIST = resolve("./web/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(path: string): Response | null {
  // Prevent directory traversal
  const safePath = path.replace(/^\/+/, "").replace(/\.\.+/g, "");
  const candidates = [join(WEB_DIST, safePath)];
  if (!extname(safePath)) candidates.push(join(WEB_DIST, "index.html"));

  for (const c of candidates) {
    if (existsSync(c) && c.startsWith(WEB_DIST)) {
      const body = readFileSync(c);
      return new Response(body, {
        headers: { "Content-Type": MIME[extname(c)] ?? "application/octet-stream" },
      });
    }
  }
  return null;
}

export function startServer() {
  const app = new Hono();
  app.route("/api", api);

  app.get("*", (c) => {
    const path = c.req.path;
    const r = serveStatic(path);
    if (r) return r;
    return c.text(
      "Web dashboard not built yet. Run `npm run build` to build the SPA, or visit /api/health.",
      404
    );
  });

  const server = serve({ fetch: app.fetch, port: config.port });
  return server;
}
