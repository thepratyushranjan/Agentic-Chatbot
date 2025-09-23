// lib/mcp.js
import fs from 'node:fs/promises';
import path from 'node:path';
import { experimental_createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Allow MariaDB tool
const ALLOWED_TOOLS = new Set([
  'connect',
  'list-collections',
  'list-databases',
  'find',
  'count',
  'aggregate',
  'explain',
  'execute_sql' // MariaDB MCP tool
]);

export async function loadAllMCPTools() {
  const configPath = path.join(process.cwd(), 'mcp-config.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);

  const clients = [];
  const toolsMap = {};

  for (const [provider, entry] of Object.entries(config || {})) {
    let transport = null;

    if (entry?.command) {
      transport = new StdioClientTransport({
        command: entry.command,
        args: Array.isArray(entry.args) ? entry.args : [],
        env: { ...process.env, ...(entry.env || {}) }
      });
    } else if (entry?.url) {
      transport = new SSEClientTransport(new URL(entry.url), {});
    } else {
      continue;
    }

    const client = await experimental_createMCPClient({ transport });
    clients.push(client);

    const tools = await client.tools();
    const entries =
      Array.isArray(tools)
        ? tools
            .filter(t => t && typeof t.name === 'string' && ALLOWED_TOOLS.has(t.name))
            .map(t => [t.name, t])
        : Object.entries(tools || {}).filter(([name]) => ALLOWED_TOOLS.has(name));

    for (const [name, def] of entries) {
      toolsMap[`${provider}.${name}`] = def;
    }
  }

  const closeAll = async () => {
    await Promise.allSettled(clients.map(c => c?.close?.()));
  };

  return { tools: toolsMap, closeAll };
}