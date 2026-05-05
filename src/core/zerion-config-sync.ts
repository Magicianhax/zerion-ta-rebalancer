/**
 * Sync the rebalancer's ZERION_API_KEY into the Zerion CLI's own config
 * (~/.zerion/config.json).
 *
 * Why: the rebalancer passes ZERION_API_KEY via env when it spawns CLI
 * subprocesses, so the rebalancer itself works fine. But users running
 * Zerion CLI commands directly from another terminal don't have that env
 * set. Persisting the key into ~/.zerion/config.json once means every
 * future `zerion ...` invocation finds it. Idempotent — only writes if
 * the stored key is missing or different.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";

function readStoredKey(): string | null {
  const path = join(homedir(), ".zerion", "config.json");
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    return typeof json.apiKey === "string" ? json.apiKey : null;
  } catch {
    return null;
  }
}

function writeStoredKey(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [config.zerionCliPath, "config", "set", "apiKey", key],
      { stdio: "ignore" },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Ensure ~/.zerion/config.json holds the same apiKey as our .env.
 * Returns true if a write happened, false if already in sync or no key set.
 */
export async function syncZerionConfig(): Promise<boolean> {
  if (!config.zerionApiKey) return false;
  if (readStoredKey() === config.zerionApiKey) return false;
  return writeStoredKey(config.zerionApiKey);
}
