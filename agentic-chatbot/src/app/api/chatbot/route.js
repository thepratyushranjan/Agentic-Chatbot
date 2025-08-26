// app/api/chatbot/route.js
import { NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { loadAllMCPTools } from '../../../lib/mcp.js';
import {
  AGENT_POLICY,
  planTools,
  filterTools,
  buildToolSet,
  looksDbRelated,
  loadDomainInstruction,
  ensureMeaningfulResponse,
} from '../../../lib/agent.js';

export const runtime = 'nodejs';

// --- helpers ---------------------------------------------------------------

function withTimeout(promiseFactory, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  const run = async () => {
    try {
      return await promiseFactory(ac.signal);
    } finally {
      clearTimeout(t);
    }
  };
  return { run };
}

// Keep only user/assistant roles from client history (defensive)
function sanitizeHistory(msgs = []) {
  return msgs
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content ?? '') }));
}

// Build a full conversation with exactly one system message at the start
function buildConversation(systemText, history, userQuery) {
  return [
    { role: 'system', content: systemText },
    ...sanitizeHistory(history),
    { role: 'user', content: userQuery },
  ];
}

// Enhanced formatting directive for natural language responses
const FORMAT_DIRECTIVE = `
CRITICAL OUTPUT REQUIREMENTS:
1. NEVER respond with just "Done" or minimal responses
2. ALWAYS provide detailed, natural language explanations of what you found
3. When presenting data from tools:
   - Start with a summary (e.g., "I found X documents matching your query")
   - Format results using Markdown: ### for headings, **bold** for emphasis, bullet points for lists
   - For documents: Show key fields in a readable format
   - For stats: Convert bytes to MB/GB, format numbers with commas
   - For lists: Use numbered or bulleted lists
4. If no results found, explain that clearly
5. Always provide context about what the data means

Example good response:
"### Query Results
I found **X results** matching your request. Here’s a summary:

1. **User: John Doe**
   - Email: john@example.com
   - Role: admin
   - Created: January 15, 2024

2. **User: Jane Smith**
   - Email: jane@example.com
   - Role: user
   - Created: February 20, 2024"

Example bad response:
"Done."

Tone & Guardrails:
- Maintain a professional, confident tone throughout all interactions
- Avoid using sentiments like 'sorry', 'please', or any form of apology
- Respond appropriately and professionally to abusive or sexually explicit language
- Stay focused on the task at hand and provide direct, helpful responses
- Use clear, authoritative language without being overly formal
- Keep it professional, concise, and clear
- Always explain what the result means in context
- Never show DB/collection names → Present as if it's a simple report, not a query dump
- No unnecessary filler words like "as requested, here is the data" → Go straight to the summary
`;

// --- route ----------------------------------------------------------------

export async function POST(req) {
  let resources = null;

  try {
    const body = await req.json();
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    const history = Array.isArray(body?.messages) ? body.messages : [];

    if (!query) {
      return NextResponse.json({ error: 'Invalid "query" provided' }, { status: 400 });
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json({ error: 'GOOGLE_GENERATIVE_AI_API_KEY not set' }, { status: 500 });
    }

    const modelName = process.env.GOOGLE_GEMINI_MODEL || 'gemini-2.5-pro';
    const model = google(modelName);

    // Load all MCP providers & tools (namespaced "<provider>.<tool>")
    const { tools: allTools, closeAll } = await loadAllMCPTools();
    resources = { closeAll };

    // Hide write tools unless user explicitly confirms
    const safeTools = buildToolSet(allTools, query);

    // Load domain instruction for DB/collection mapping
    const DOMAIN = loadDomainInstruction();

    // Enhanced system prompt for natural language responses
    const enhancedSystemPrompt = `${AGENT_POLICY}
${DOMAIN ? DOMAIN + '\n' : ''}
Available tools: ${Object.keys(safeTools).join(', ') || 'None'}

REMEMBER: You MUST interpret ALL tool results into natural, readable language. Never just say "Done."

${FORMAT_DIRECTIVE}`;

    // Base conversation (single system at the very beginning)
    const baseMessages = buildConversation(
      enhancedSystemPrompt,
      history,
      query
    );

    // PLAN step (no tool execution) → which tools to allow?
    const plannedToolNames = await planTools(
      model,
      [...sanitizeHistory(history), { role: 'user', content: query }],
      safeTools
    );

    const execTools = filterTools(safeTools, plannedToolNames);

    // EXECUTE (agentic, auto tool calls)
    const timeoutMs = Number(process.env.CHATBOT_RESPONSE_TIMEOUT_MS || 45000);
    const runGen = withTimeout(
      (signal) =>
        generateText({
          model,
          messages: baseMessages,
          tools: execTools,
          maxToolRoundtrips: 16,
          signal,
        }),
      timeoutMs
    );

    let result = await runGen.run();

    // Nudge: if DB-like and no tool used, force a tools-first retry
    if (
      looksDbRelated(query) &&
      (!result.toolCalls || result.toolCalls.length === 0) &&
      Object.keys(execTools).length > 0
    ) {
      const forcedMessages = buildConversation(
        `${AGENT_POLICY}\n${DOMAIN ? DOMAIN + '\n' : ''}
CRITICAL: This query is database-related. You MUST:
1. Call at least one MCP tool
2. Interpret ALL results into natural language
3. NEVER just say "Done"

${FORMAT_DIRECTIVE}`,
        history,
        query
      );

      result = await generateText({
        model,
        messages: forcedMessages,
        tools: execTools,
        maxToolRoundtrips: 16,
      });
    }

    // Check if response is too minimal and force re-interpretation
    let finalText = (result?.text || '').trim();
    
    if (finalText.toLowerCase() === 'done' || finalText.toLowerCase() === 'done.' || finalText.length < 20) {
      // If we have tool results but minimal text, force the model to interpret them
      if (result.toolResults && result.toolResults.length > 0) {
        const interpretMessages = [
          {
            role: 'system',
            content: `You just executed tools but provided a minimal response. 
You MUST now interpret the tool results into natural language.
${FORMAT_DIRECTIVE}

Tool results to interpret: ${JSON.stringify(result.toolResults)}

Provide a detailed, natural language explanation of what was found.`
          },
          {
            role: 'user',
            content: `Please explain what you found from the ${query}`
          }
        ];

        const interpretResult = await generateText({
          model,
          messages: interpretMessages,
          tools: {}, // No tools for interpretation phase
        });

        finalText = interpretResult.text || finalText;
      }
    }

    // Use fallback if still minimal
    finalText = ensureMeaningfulResponse(finalText, result.toolResults);

    return NextResponse.json({
      result: finalText,
      plannedTools: plannedToolNames,
      toolCalls: result.toolCalls || [],
      toolResults: result.toolResults || [], // Keep for debugging
    });
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return NextResponse.json(
      { error: isAbort ? 'Timed out waiting for model/tools' : (err?.message || 'Internal Error') },
      { status: 500 }
    );
  } finally {
    if (resources?.closeAll) {
      try { await resources.closeAll(); } catch {}
    }
  }
}