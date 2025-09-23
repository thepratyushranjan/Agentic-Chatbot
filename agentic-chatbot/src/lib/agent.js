// lib/agent.js
import { generateText } from 'ai';
import fs from 'fs';
import path from 'path';

const WRITE_NAME_RE = /(insert|update|delete|create[-_ ]?index|drop|write|bulk|merge|out)$/i;

export function looksDbRelated(q = '') {
  // Enhanced to detect MariaDB/SQL queries and account/name lookups
  return /\b(db|database|collection|collections|find|aggregate|count|index|indexes|schema|stats|log|logs|explain|collstats|storage size|size on disk|perf|performance|mongodb|mariadb|sql|account|account id|name|user|customer|lookup|search for|get|retrieve)\b/i.test(q);
}

// --- domain instruction loader ---------------------------------------------
let cachedDomainInstruction = null;

function resolvePromptPaths() {
  const basePaths = [
    path.join(process.cwd(), 'prompt'),
    path.join(process.cwd(), 'agentic-chatbot', 'prompt'),
  ];
  
  const files = {
    mongodb: null,
    mariadb: null
  };
  
  for (const base of basePaths) {
    try {
      const mongoPath = path.join(base, 'chat-bot.md');
      const mariaPath = path.join(base, 'mariadb-instructions.md');
      
      if (fs.existsSync(mongoPath)) files.mongodb = mongoPath;
      if (fs.existsSync(mariaPath)) files.mariadb = mariaPath;
      
      if (files.mongodb || files.mariadb) break;
    } catch {}
  }
  
  return files;
}

export function loadDomainInstruction() {
  if (cachedDomainInstruction !== null) return cachedDomainInstruction;
  
  const files = resolvePromptPaths();
  let instructions = '';
  
  try {
    if (files.mongodb) {
      const mongoContent = fs.readFileSync(files.mongodb, 'utf8');
      instructions += `MongoDB guidance (from prompt/chat-bot.md):\n${mongoContent}\n\n`;
    }
    
    if (files.mariadb) {
      const mariaContent = fs.readFileSync(files.mariadb, 'utf8');
      instructions += `MariaDB guidance (from prompt/mariadb-instructions.md):\n${mariaContent}\n`;
    }
    
    cachedDomainInstruction = instructions || '';
  } catch {
    cachedDomainInstruction = '';
  }
  
  return cachedDomainInstruction;
}

export function buildToolSet(allTools, query) {
  const confirmed = /confirm:\s*(true|yes)/i.test(query || '');
  if (confirmed) return allTools;

  const safe = {};
  for (const [name, def] of Object.entries(allTools || {})) {
    if (!WRITE_NAME_RE.test(name)) safe[name] = def;
  }
  return safe;
}

export function filterTools(all, allowList) {
  if (!allowList?.length) return all;
  const filtered = {};
  for (const k of allowList) if (all[k]) filtered[k] = all[k];
  return Object.keys(filtered).length ? filtered : all;
}

export async function planTools(model, historyMessages, tools, providerOptions) {
  const domain = loadDomainInstruction();
  
  // Enhanced system prompt to handle both MongoDB and MariaDB
  const systemContent = `You are a strict planner. Decide which MCP tools to use.

Database Selection Rules:
- For account names, account IDs, user lookups, customer searches → use mariadb-mcp-server.execute_sql with database name information_schema
- For cloud costs, expenses, resources, security checks → use MongoDB tools
- For MongoDB queries → use appropriate mongodb tools (find, aggregate, count, etc.)

IMPORTANT for MariaDB:
- Always use database name is information_schema
- Used table name is "cloudaccount"
- NEVER hallucinate table or database names
- Validate SQL queries before execution

${domain ? domain + '\n' : ''}

Available tools: ${Object.keys(tools).join(', ')}

Return STRICT JSON only: {"tools":[{"name":"<exact-tool-name>","why":"<short>"}]}`;

  const { text } = await generateText({
    model,
    messages: [
      { role: 'system', content: systemContent },
      ...historyMessages,
    ],
    tools: {},
    providerOptions,
  });

  try {
    const plan = JSON.parse(text || '{}');
    const chosen = (plan.tools || [])
      .map((t) => (t && t.name ? String(t.name) : ''))
      .filter((n) => n && tools[n]);

    return [...new Set(chosen)];
  } catch {
    return [];
  }
}

export function ensureMeaningfulResponse(text, toolResults) {
  const minimalResponses = ['done', 'done.', 'completed', 'finished', 'ok', 'okay'];
  const isMinimal = minimalResponses.includes(text.toLowerCase().trim());
  
  if (isMinimal && toolResults && toolResults.length > 0) {
    let fallback = "I've completed the operation. ";
    
    for (const result of toolResults) {
      if (result?.content) {
        const content = Array.isArray(result.content) ? result.content : [result.content];
        const textContent = content
          .filter(c => c?.type === 'text' && c?.text)
          .map(c => c.text);
        
        if (textContent.length > 0) {
          // Handle SQL query results
          if (textContent[0].includes('id') || textContent[0].includes('account')) {
            try {
              const parsed = JSON.parse(textContent[0]);
              if (Array.isArray(parsed) && parsed.length > 0) {
                fallback = `I found ${parsed.length} result${parsed.length !== 1 ? 's' : ''}:\n\n`;
                parsed.forEach((row, i) => {
                  fallback += `**Result ${i + 1}:**\n`;
                  for (const [key, value] of Object.entries(row)) {
                    fallback += `- ${key}: ${value}\n`;
                  }
                  fallback += '\n';
                });
              } else if (typeof parsed === 'object') {
                fallback = "Here's the result:\n\n";
                for (const [key, value] of Object.entries(parsed)) {
                  fallback += `- ${key}: ${value}\n`;
                }
              }
            } catch {
              fallback = textContent.join('\n\n');
            }
          } else if (textContent[0].includes('"_id"')) {
            // MongoDB results handling
            fallback = `I found ${textContent.length} document${textContent.length !== 1 ? 's' : ''} in the collection. `;
            if (textContent.length <= 3) {
              fallback += "Here are the results:\n\n";
              textContent.forEach((doc, i) => {
                try {
                  const parsed = JSON.parse(doc);
                  fallback += `**Document ${i + 1}:**\n`;
                  for (const [key, value] of Object.entries(parsed)) {
                    if (key !== '_id') {
                      fallback += `- ${key}: ${JSON.stringify(value, null, 2)}\n`;
                    }
                  }
                  fallback += '\n';
                } catch {
                  fallback += `${doc}\n\n`;
                }
              });
            }
          } else {
            fallback = textContent.join('\n\n');
          }
        }
      }
    }
    
    return fallback;
  }
  
  return text;
}