import { NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { experimental_createMCPClient } from 'ai';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// Cache for MCP client to avoid recreating it on every request
let mcpClientCache = null;
let mcpToolsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function extractNamesFromArray(value) {
  if (!Array.isArray(value)) return [];
  const names = [];
  for (const item of value) {
    if (typeof item === 'string') names.push(item);
    else if (item && typeof item === 'object') {
      const candidate = item.name || item.db || item.database || item.collection || item.collectionName;
      if (typeof candidate === 'string') names.push(candidate);
    }
  }
  return names;
}

function parseListDatabases(payload) {
  // Returns [{ name: string, sizeBytes?: number }]
  const results = [];
  if (!payload) return results;

  // Common shapes: { databases: [{ name, sizeOnDisk }] }
  if (Array.isArray(payload.databases)) {
    for (const db of payload.databases) {
      const name = (db?.name ?? db?.db ?? db?.database ?? '').toString();
      if (!name) continue;
      const size = Number(db?.sizeOnDisk ?? db?.size ?? db?.bytes);
      results.push({ name, sizeBytes: Number.isFinite(size) ? size : undefined });
    }
    return results;
  }

  // Direct array of names/objects
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === 'string') results.push({ name: item });
      else if (item && typeof item === 'object') {
        const name = (item.name ?? item.db ?? item.database ?? '').toString();
        if (!name) continue;
        const size = Number(item?.sizeOnDisk ?? item?.size ?? item?.bytes);
        results.push({ name, sizeBytes: Number.isFinite(size) ? size : undefined });
      }
    }
    return results;
  }

  // MCP content array: { content: [{ type: 'text', text: 'Name: X, Size: Y bytes' }, ...] }
  if (Array.isArray(payload.content)) {
    const regex = /Name:\s*([^,]+),\s*Size:\s*([0-9]+)\s*bytes/i;
    for (const part of payload.content) {
      const text = (part?.text ?? part?.content ?? '').toString();
      if (!text) continue;
      const m = text.match(regex);
      if (m) {
        const name = m[1].trim();
        const sizeBytes = Number(m[2]);
        results.push({ name, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined });
      } else {
        // If no size present, try to capture just the name
        const nameOnly = text.replace(/^Name:\s*/i, '').trim();
        if (nameOnly) results.push({ name: nameOnly });
      }
    }
    return results;
  }

  return results;
}

// NEW: Parse list-collections outputs into an array of names
function parseListCollections(payload) {
  // Returns [name: string]
  const results = [];
  if (!payload) return results;

  // If tool returned { collections: [...] }
  const colArray = Array.isArray(payload?.collections) ? payload.collections : payload;

  // Direct array of names/objects
  if (Array.isArray(colArray)) {
    for (const item of colArray) {
      if (typeof item === 'string') results.push(item);
      else if (item && typeof item === 'object') {
        const candidate = item.name || item.collection || item.collectionName;
        if (typeof candidate === 'string') results.push(candidate);
      }
    }
    return results;
  }

  // MCP content array: { content: [{ type: 'text', text: 'Name: "collection_name"' }, ...] }
  if (Array.isArray(payload?.content)) {
    for (const part of payload.content) {
      const text = (part?.text ?? part?.content ?? '').toString();
      if (!text) continue;
      // Try to capture Name: "foo" or Name: foo
      const m = text.match(/Name:\s*\"?([^\"]+)\"?/i);
      if (m && m[1]) {
        results.push(m[1].trim());
      }
    }
    return results;
  }

  return results;
}

// Parse collection indexes output into a normalized array
function parseCollectionIndexes(payload) {
  const out = [];
  if (!payload) return out;

  const arr = Array.isArray(payload?.indexes) ? payload.indexes : Array.isArray(payload) ? payload : null;
  if (Array.isArray(arr)) {
    for (const idx of arr) {
      if (!idx || typeof idx !== 'object') continue;
      const name = (idx.name ?? idx.index ?? '').toString();
      const key = idx.key ?? idx.keys ?? idx.fields;
      const unique = Boolean(idx.unique);
      const sparse = Boolean(idx.sparse);
      const ttlSeconds = Number.isFinite(Number(idx.expireAfterSeconds)) ? Number(idx.expireAfterSeconds) : undefined;
      out.push({ name, key, unique, sparse, ttlSeconds });
    }
    return out;
  }

  if (Array.isArray(payload?.content)) {
    for (const part of payload.content) {
      const text = (part?.text ?? part?.content ?? '').toString();
      if (!text) continue;
      try {
        const maybeJson = JSON.parse(text);
        const nested = parseCollectionIndexes(maybeJson);
        if (nested.length) out.push(...nested);
      } catch {
        const m = text.match(/Name:\s*([^,]+),\s*Keys?:\s*(\{.*\})/i);
        if (m) {
          let keyObj = undefined;
          try { keyObj = JSON.parse(m[2]); } catch {}
          out.push({ name: m[1].trim(), key: keyObj });
        }
      }
    }
  }
  return out;
}

// Parse create-index result
function parseCreateIndexResult(payload) {
  if (!payload) return { ok: false };
  if (typeof payload === 'string') return { ok: true, message: payload };
  if (typeof payload === 'number') return { ok: payload === 1 };
  if (payload && typeof payload === 'object') {
    const ok = payload.ok === 1 || payload.acknowledged === true || payload.success === true;
    const name = payload.name ?? payload.index ?? payload.createdIndexName;
    return { ok: Boolean(ok), name: typeof name === 'string' ? name : undefined, details: payload };
  }
  return { ok: false };
}

// Parse find/aggregate results into array of documents
function parseDocumentsArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.documents)) return payload.documents;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.content)) {
    const docs = [];
    for (const part of payload.content) {
      const text = (part?.text ?? part?.content ?? '').toString();
      if (!text) continue;
      // Try to parse JSON document lines
      try {
        const maybe = JSON.parse(text);
        if (Array.isArray(maybe)) docs.push(...maybe);
        else if (maybe && typeof maybe === 'object') docs.push(maybe);
      } catch {}
    }
    return docs;
  }
  return [];
}

// Parse collection storage size
function parseCollectionStorageSize(payload) {
  if (!payload) return {};
  if (typeof payload === 'number') return { sizeBytes: payload };
  if (payload && typeof payload === 'object') {
    const sizeBytes = payload.sizeBytes ?? payload.storageSize ?? payload.size ?? payload.totalSize ?? payload.bytes;
    const num = Number(sizeBytes);
    return { sizeBytes: Number.isFinite(num) ? num : undefined, raw: payload };
  }
  return {};
}

// Parse dbStats
function parseDbStats(payload) {
  if (payload && typeof payload === 'object') return payload;
  try { return JSON.parse(String(payload)); } catch {}
  return {};
}

// Parse explain summary
function parseExplainSummary(payload) {
  const obj = typeof payload === 'object' && payload ? payload : (function() { try { return JSON.parse(String(payload)); } catch { return null; } })();
  if (!obj) return '';
  const qp = obj.queryPlanner || obj.queryPlannerExtended || obj.plan;
  if (qp?.winningPlan) return `Winning plan: ${JSON.stringify(qp.winningPlan)}`;
  if (qp) return `Plan: ${JSON.stringify(qp)}`;
  return JSON.stringify(obj);
}

// Parse MongoDB logs
function parseMongoLogs(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.map(v => typeof v === 'string' ? v : JSON.stringify(v));
  if (Array.isArray(payload?.logs)) return payload.logs.map(v => typeof v === 'string' ? v : JSON.stringify(v));
  if (Array.isArray(payload?.content)) {
    const out = [];
    for (const part of payload.content) {
      const text = (part?.text ?? part?.content ?? '').toString();
      if (text) out.push(text);
    }
    return out;
  }
  return [typeof payload === 'string' ? payload : JSON.stringify(payload)];
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toFixed(2)} ${units[idx]}`;
}

function uniqueByName(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.name || '').toString();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function toMarkdownTable(rows, headers) {
  // rows: array of arrays; headers: array of strings
  const header = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(v => (v ?? '').toString()).join(' | ')} |`).join('\n');
  return `${header}\n${sep}\n${body}`;
}

function formatToolResultsToNaturalLanguage(toolResults, userQuery) {
  if (!Array.isArray(toolResults) || toolResults.length === 0) return '';
  const sentences = [];
  const wantsTable = /\btable\b|\btabular\b|\btable\s*form/i.test(userQuery || '');

  for (const tr of toolResults) {
    const toolName = (tr?.toolName || tr?.tool || '').toString().toLowerCase();
    const payload = tr?.result ?? tr?.output ?? tr?.data ?? tr;

    if (toolName.includes('list-databases')) {
      const parsed = uniqueByName(parseListDatabases(payload));
      if (parsed.length > 0) {
        if (wantsTable) {
          const rows = parsed.map(db => [db.name, db.sizeBytes != null ? `${db.sizeBytes} bytes` : '—']);
          const table = toMarkdownTable(rows, ['Database Name', 'Size on Disk']);
          sentences.push('Here are the databases:');
          sentences.push(table);
        } else {
          const names = parsed.map(d => d.name).join(', ');
          sentences.push(`I found ${parsed.length} database${parsed.length === 1 ? '' : 's'}: ${names}.`);
        }
        continue;
      }
    }

    // List collections
    if (toolName.includes('list-collections')) {
      const names = parseListCollections(payload);
      if (names.length > 0) {
        if (wantsTable) {
          const rows = names.map(n => [n]);
          const table = toMarkdownTable(rows, ['Collection Name']);
          sentences.push('Here are the collections:');
          sentences.push(table);
        } else {
          sentences.push(`The available collections are: ${names.join(', ')}.`);
        }
        continue;
      }
    }

    // Switch connection
    if (toolName.includes('switch-connection')) {
      try {
        const details = typeof payload === 'string' ? payload : JSON.stringify(payload);
        sentences.push(`Switched MongoDB connection. Details: ${details}`);
      } catch {
        sentences.push('Switched MongoDB connection.');
      }
      continue;
    }

    // Collection indexes
    if (toolName.includes('collection-indexes')) {
      const idxs = parseCollectionIndexes(payload);
      if (idxs.length) {
        if (wantsTable) {
          const rows = idxs.map(i => [i.name || '—', JSON.stringify(i.key ?? {}), String(i.unique), String(i.sparse), i.ttlSeconds != null ? String(i.ttlSeconds) : '—']);
          const table = toMarkdownTable(rows, ['Index Name', 'Key', 'Unique', 'Sparse', 'TTL (s)']);
          sentences.push('Indexes for the collection:');
          sentences.push(table);
        } else {
          sentences.push(`Found ${idxs.length} index${idxs.length === 1 ? '' : 'es'}: ${idxs.map(i => i.name || 'unnamed').join(', ')}.`);
        }
        continue;
      }
    }

    // Create index
    if (toolName.includes('create-index')) {
      const info = parseCreateIndexResult(payload);
      if (info.ok) {
        sentences.push(`Index created${info.name ? `: ${info.name}` : ''}.`);
      } else {
        sentences.push(`Index creation response: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
      }
      continue;
    }

    // Collection schema
    if (toolName.includes('collection-schema')) {
      try {
        const schemaStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        sentences.push('Collection schema:');
        sentences.push('```json');
        sentences.push(schemaStr);
        sentences.push('```');
      } catch {
        sentences.push('Received collection schema.');
      }
      continue;
    }

    // Find
    if (toolName === 'find' || toolName.includes(' find')) {
      const docs = parseDocumentsArray(payload);
      if (docs.length) {
        sentences.push(`Found ${docs.length} document${docs.length === 1 ? '' : 's'}. Showing up to 3:`);
        const preview = docs.slice(0, 3);
        sentences.push('```json');
        sentences.push(JSON.stringify(preview, null, 2));
        sentences.push('```');
        continue;
      }
    }

    // Collection storage size
    if (toolName.includes('collection-storage-size')) {
      const { sizeBytes } = parseCollectionStorageSize(payload);
      if (Number.isFinite(sizeBytes)) {
        sentences.push(`Collection storage size: ${sizeBytes} bytes (${humanBytes(sizeBytes)}).`);
      } else {
        try {
          sentences.push(`Collection storage size response: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
        } catch {}
      }
      continue;
    }

    // Count results
    if (toolName.includes('count')) {
      let count = null;
      if (typeof payload === 'number') count = payload;
      else if (payload && typeof payload === 'object') {
        const maybe = payload.count ?? payload.total ?? payload.result ?? null;
        if (typeof maybe === 'number') count = maybe;
      }
      if (typeof count === 'number') {
        sentences.push(`The count is ${count}.`);
        continue;
      }
    }

    // DB stats
    if (toolName.includes('db-stats')) {
      const stats = parseDbStats(payload);
      const collections = stats.collections ?? stats.ns ? undefined : undefined;
      const objects = stats.objects ?? stats.count;
      const dataSize = stats.dataSize ?? stats.size;
      const storageSize = stats.storageSize ?? stats.totalSize;
      const indexSize = stats.indexSize;
      const lines = [];
      if (Number.isFinite(collections)) lines.push(`Collections: ${collections}`);
      if (Number.isFinite(objects)) lines.push(`Documents: ${objects}`);
      if (Number.isFinite(dataSize)) lines.push(`Data size: ${humanBytes(dataSize)} (${dataSize} bytes)`);
      if (Number.isFinite(storageSize)) lines.push(`Storage size: ${humanBytes(storageSize)} (${storageSize} bytes)`);
      if (Number.isFinite(indexSize)) lines.push(`Index size: ${humanBytes(indexSize)} (${indexSize} bytes)`);
      if (lines.length) sentences.push(lines.join('\n'));
      else {
        try { sentences.push(`DB stats: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`); } catch {}
      }
      continue;
    }

    // Aggregate
    if (toolName.includes('aggregate')) {
      const docs = parseDocumentsArray(payload);
      if (docs.length) {
        sentences.push(`Aggregation returned ${docs.length} result${docs.length === 1 ? '' : 's'}. Showing up to 3:`);
        sentences.push('```json');
        sentences.push(JSON.stringify(docs.slice(0, 3), null, 2));
        sentences.push('```');
        continue;
      }
    }

    // Explain
    if (toolName.includes('explain')) {
      const summary = parseExplainSummary(payload);
      if (summary) {
        sentences.push(summary);
        continue;
      }
    }

    // MongoDB logs
    if (toolName.includes('mongodb-logs') || toolName.includes('mongo-logs') || toolName.includes('logs')) {
      const lines = parseMongoLogs(payload);
      if (lines.length) {
        const shown = lines.slice(0, 20); // limit
        sentences.push('Recent MongoDB log entries:');
        sentences.push('```');
        sentences.push(shown.join('\n'));
        sentences.push('```');
        continue;
      }
    }

    // Generic fallback sentence
    try {
      const preview = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const trimmed = preview; // Do not truncate; return full content
      if (toolName) sentences.push(`I ran ${toolName.replace(/mcp_|mongodb_|mongo_/g, '')} and obtained a result: ${trimmed}`);
      else sentences.push(`I obtained a result: ${trimmed}`);
    } catch {}
  }

  return sentences.join('\n');
}

async function getMCPClient() {
  const now = Date.now();
  
  // Return cached client if still valid
  if (mcpClientCache && mcpToolsCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return { client: mcpClientCache, tools: mcpToolsCache };
  }

  try {
    const configPath = path.join(process.cwd(), 'mcp-config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);

    const entry = config?.mongodb;
    if (!entry?.command) {
      throw new Error('Invalid mcp-config.json: missing mongodb.command');
    }

    const transport = new StdioClientTransport({
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args : [],
      env: { ...process.env, ...(entry.env || {}) },
    });

    const client = await experimental_createMCPClient({ transport });
    const tools = await client.tools();

    // Update cache
    mcpClientCache = client;
    mcpToolsCache = tools;
    cacheTimestamp = now;

    return { client, tools };
  } catch (error) {
    console.error('Failed to create MCP client:', error);
    throw error;
  }
}

export async function POST(req) {
  let mcpClient = null;
  
  try {
    const { query, messages = [] } = await req.json();

    if (typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json({ error: 'Invalid "query" provided' }, { status: 400 });
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { error: 'Server misconfiguration: GOOGLE_GENERATIVE_AI_API_KEY is not set' },
        { status: 500 }
      );
    }

    const modelName = process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.5-pro';
    const model = google(modelName);

    // Get MCP client and tools
    let tools = {};
    try {
      const mcpData = await getMCPClient();
      mcpClient = mcpData.client;
      tools = mcpData.tools || {};
    } catch (mcpError) {
      console.warn('MCP client unavailable, proceeding without tools:', mcpError.message);
    }

    // Prepare conversation history
    const conversationMessages = [
      {
        role: 'system',
        content: `You are a helpful AI assistant with access to MongoDB database tools. 
        
When users ask questions that might require database operations, you should:
1. Use the available MongoDB tools to query, insert, update, or delete data as needed
2. Process the results and present them in a clear, natural language format
3. Explain what operations were performed when relevant

Available tools: ${Object.keys(tools).join(', ') || 'None'}

Always be helpful, accurate, and provide context for any database operations you perform.`
      },
      ...messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: 'user',
        content: query
      }
    ];

    // Generate response with tool calling, guarded by a timeout
    const abortController = new AbortController();
    const timeoutMs = Number(process.env.CHATBOT_RESPONSE_TIMEOUT_MS || 30000);
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    let result;
    try {
      result = await generateText({
        model,
        messages: conversationMessages,
        tools: tools,
        maxToolRoundtrips: 3,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    let text = (result && typeof result.text === 'string' && result.text.trim().length > 0)
      ? result.text
      : '';

    if (!text) {
      const toolResults = Array.isArray(result?.toolResults) ? result.toolResults : [];
      const spoken = formatToolResultsToNaturalLanguage(toolResults, query);
      if (spoken && spoken.trim()) {
        text = spoken;
      }
    }

    if (!text) {
      text = 'No response generated. The database tools may be unavailable or timed out.';
    }

    return NextResponse.json({ 
      result: text,
      toolCalls: result.toolCalls || [],
      toolResults: result.toolResults || []
    });

  } catch (error) {
    console.error('Error processing the request:', error);
    const isAbort = error?.name === 'AbortError';
    return NextResponse.json({ 
      error: 'Internal Server Error',
      details: isAbort ? 'Timed out waiting for the model or tools to respond' : error.message 
    }, { status: 500 });
  } finally {
    if (mcpClient && !mcpClientCache) {
      try {
        await mcpClient.close();
      } catch (closeError) {
        console.error('Error closing MCP client:', closeError);
      }
    }
  }
} 