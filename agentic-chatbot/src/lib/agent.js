// lib/agent.js
import { generateText } from 'ai';
import fs from 'fs';
import path from 'path';

export const AGENT_POLICY = `
You are an Agentic assistant with MCP tools. Decide—per user query—whether to call a tool.

Core rules:
- If the user references databases, collections, documents, queries, counts, schemas, indexes, stats, logs, or performance, you MUST use at least one MongoDB MCP tool to answer.
- Never hallucinate DB or collection names. If unknown, first discover with list-databases or list-collections.
- Validate user filters. If the JSON is invalid, ask briefly for a corrected filter.
- Prefer read-only operations (find, aggregate, count, db-stats, explain, collection-indexes, storage sizes, logs) for exploration.
- Destructive operations (insert, update, delete, create-index, drop, $out, $merge) require explicit user consent: the user must include 'confirm: true' or 'confirm: yes'. Without it, DO NOT execute—return a short plan stating what would run upon confirmation.

CRITICAL OUTPUT RULES:
- NEVER just say "Done" or provide minimal responses
- ALWAYS interpret and explain tool results in natural, conversational language
- When tools return data, you MUST:
  1. Summarize what was found (e.g., "I found **X results** matching your request.")
  2. Highlight key information from the results
  3. Present data in a readable format (use bullet points, tables, or paragraphs)
  4. Provide context and insights about the data
- If a query returns empty results, explain that clearly
- If showing document examples, format them nicely with proper field labels
- Convert technical values (bytes to MB/GB, timestamps to dates, etc.)


Tone & Guardrails:
- Maintain a professional, confident tone throughout all interactions
- Avoid using sentiments like 'sorry', 'please', or any form of apology
- Respond appropriately and professionally to abusive or sexually explicit language
- Stay focused on the task at hand and provide direct, helpful responses
- Use clear, authoritative language without being overly formal

Safety:
- Never run drop operations.
- Never run insert, update, or delete unless the user explicitly instructs with 'confirm: true'.
- Never run $out or $merge unless the user explicitly instructs with 'confirm: true'.
`;

const WRITE_NAME_RE = /(insert|update|delete|create[-_ ]?index|drop|write|bulk|merge|out)$/i;

export function looksDbRelated(q = '') {
  return /\b(db|database|collection|collections|find|aggregate|count|index|indexes|schema|stats|log|logs|explain|collstats|storage size|size on disk|perf|performance|mongodb)\b/i.test(q);
}

// --- domain instruction loader ---------------------------------------------
let cachedDomainInstruction = null;

function resolvePromptPath() {
  // Prefer project-local path; try a couple of likely bases
  const candidates = [
    path.join(process.cwd(), 'prompt', 'chat-bot.md'),
    path.join(process.cwd(), 'agentic-chatbot', 'prompt', 'chat-bot.md'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

export function loadDomainInstruction() {
  if (cachedDomainInstruction !== null) return cachedDomainInstruction;
  const filePath = resolvePromptPath();
  if (!filePath) {
    cachedDomainInstruction = '';
    return cachedDomainInstruction;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    // Add a short preface to make intent explicit for the model
    cachedDomainInstruction = `Domain guidance for DB/collection selection (from prompt/chat-bot.md):\n${raw}`;
  } catch {
    cachedDomainInstruction = '';
  }
  return cachedDomainInstruction;
}

export function buildToolSet(allTools, query) {
  const confirmed = /confirm:\s*(true|yes)/i.test(query || '');
  if (confirmed) return allTools;

  // Hide write-capable tools unless explicitly confirmed
  const safe = {};
  for (const [name, def] of Object.entries(allTools || {})) {
    if (!WRITE_NAME_RE.test(name)) safe[name] = def;
  }
  return safe;
}

export function filterTools(all, allowList) {
  if (!allowList?.length) return all; // fallback: allow all visible tools
  const filtered = {};
  for (const k of allowList) if (all[k]) filtered[k] = all[k];
  // If planner proposed nothing valid, fall back to all
  return Object.keys(filtered).length ? filtered : all;
}

/**
 * Plan step: ask the model which tools it intends to use (no execution).
 * Returns array of names (must match the keys in the tools map).
 */
export async function planTools(model, historyMessages, tools) {
  const domain = loadDomainInstruction();
  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict planner. Decide which MCP tools to use.\n' +
          'Use the following domain guidance to infer the correct database and collection for the query. If unspecified, prefer database "restapi" and select the collection based on the guidance.\n' +
          (domain ? `${domain}\n` : '') +
          'Return STRICT JSON only (no prose): {"tools":[{"name":"<exact-tool-name>","why":"<short>"}]}'
      },
      ...historyMessages,
    ],
    tools: {}, // planning only — do NOT execute tools here
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

/**
 * Post-process the AI response to ensure it contains meaningful content
 */
export function ensureMeaningfulResponse(text, toolResults) {
  // Check if response is too minimal
  const minimalResponses = ['done', 'done.', 'completed', 'finished', 'ok', 'okay'];
  const isMinimal = minimalResponses.includes(text.toLowerCase().trim());
  
  if (isMinimal && toolResults && toolResults.length > 0) {
    // Generate a fallback response based on tool results
    let fallback = "I've completed the operation. ";
    
    // Try to extract meaningful information from tool results
    for (const result of toolResults) {
      if (result?.content) {
        const content = Array.isArray(result.content) ? result.content : [result.content];
        const textContent = content
          .filter(c => c?.type === 'text' && c?.text)
          .map(c => c.text);
        
        if (textContent.length > 0) {
          // Count documents if it looks like a find result
          if (textContent[0].includes('"_id"')) {
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
            } else {
              fallback += `The documents contain various data. Would you like me to show specific fields or filter the results?`;
            }
          } else {
            // Generic response for other types of results
            fallback = textContent.join('\n\n');
          }
        }
      }
    }
    
    return fallback;
  }
  
  return text;
}