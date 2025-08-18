import fs from 'node:fs/promises';
import path from 'node:path';
import { experimental_createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Loads all MCP providers defined in ./mcp-config.json
 * Returns { tools: Map<string, Tool>, closeAll: () => Promise<void> }
 * Tool names are namespaced as "<provider>.<tool>"
 */
export async function loadAllMCPTools() {
  const configPath = path.join(process.cwd(), 'mcp-config.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);

  const clients = [];
  const toolsMap = {};

  for (const [provider, entry] of Object.entries(config || {})) {
    if (!entry?.command) continue;

    const transport = new StdioClientTransport({
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
      env: { ...process.env, ...(entry.env || {}) },
    });

    const client = await experimental_createMCPClient({ transport });
    const tools = await client.tools();

    for (const [name, def] of Object.entries(tools || {})) {
      toolsMap[`${provider}.${name}`] = def;
    }
    clients.push(client);
  }

  const closeAll = async () => {
    await Promise.allSettled(clients.map((c) => c?.close?.()));
  };

  return { tools: toolsMap, closeAll };
}
