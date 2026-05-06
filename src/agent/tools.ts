/**
 * Agent tool registry. Two MCP servers exposed to the agent:
 *   - rebalancer-read: read-only inspection (chat surface)
 *   - rebalancer-full: read + state-changing actions (cron surface)
 *
 * Tool implementations live in tools/{read,actions}.ts.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  getBasketTool,
  getHistoryTool,
  getLastRebalanceTool,
  getPortfolioTool,
  getTaScoresTool,
  listBasketsTool,
} from "./tools/read.ts";
import {
  executeRebalanceTool,
  setBasketEnabledTool,
} from "./tools/actions.ts";

const READ_ONLY_TOOLS = [
  listBasketsTool,
  getBasketTool,
  getPortfolioTool,
  getTaScoresTool,
  getHistoryTool,
  getLastRebalanceTool,
];

const ACTION_TOOLS = [executeRebalanceTool, setBasketEnabledTool];

export const readOnlyServer = createSdkMcpServer({
  name: "rebalancer-read",
  version: "1.0.0",
  tools: READ_ONLY_TOOLS,
});

export const fullServer = createSdkMcpServer({
  name: "rebalancer-full",
  version: "1.0.0",
  tools: [...READ_ONLY_TOOLS, ...ACTION_TOOLS],
});

/** Tool name prefixes per the SDK's mcp__<server>__<tool> convention. */
function toolNames(server: string, tools: { name?: string }[]): string[] {
  return tools.map((t) => `mcp__${server}__${t.name}`);
}

export const READ_ONLY_TOOL_NAMES = toolNames("rebalancer-read", READ_ONLY_TOOLS);
export const FULL_TOOL_NAMES = toolNames(
  "rebalancer-full",
  [...READ_ONLY_TOOLS, ...ACTION_TOOLS],
);
