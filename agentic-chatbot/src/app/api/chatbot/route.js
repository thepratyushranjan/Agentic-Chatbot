import { NextResponse } from "next/server";
import { google } from "@ai-sdk/google";
import { generateText, streamText } from "ai";
import { loadAllMCPTools } from "../../../lib/mcp.js";
import {
  planTools,
  filterTools,
  buildToolSet,
  looksDbRelated,
  loadDomainInstruction,
  ensureMeaningfulResponse,
} from "../../../lib/agent.js";
import {
  AGENT_POLICY,
  FORMAT_DIRECTIVE,
} from "../../../../prompt/constant_prompt.js";

export const runtime = "nodejs";

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

// Thinking budget helpers ----------------------------------------------------
function getEnvInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function buildProviderOptions(budget) {
  return {
    google: {
      generationConfig: {
        thinkingConfig: { thinkingBudget: budget },
      },
    },
  };
}

// Keep only user/assistant roles from client history (defensive)
function sanitizeHistory(msgs = []) {
  return msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }));
}

// Build a full conversation with exactly one system message at the start
function buildConversation(systemText, history, userQuery) {
  return [
    { role: "system", content: systemText },
    ...sanitizeHistory(history),
    { role: "user", content: userQuery },
  ];
}


// --- route ----------------------------------------------------------------

export async function POST(req) {
  let resources = null;

  try {
    const url = new URL(req.url);
    const streamMode = url.searchParams.get("stream") === "1";
    const body = await req.json();
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const history = Array.isArray(body?.messages) ? body.messages : [];

    if (!query) {
      return NextResponse.json(
        { error: 'Invalid "query" provided' },
        { status: 400 }
      );
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { error: "GOOGLE_GENERATIVE_AI_API_KEY not set" },
        { status: 500 }
      );
    }

    const modelName = process.env.GOOGLE_GEMINI_MODEL || "gemini-2.5-pro";
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
${DOMAIN ? DOMAIN + "\n" : ""}
Available tools: ${Object.keys(safeTools).join(", ") || "None"}

REMEMBER: You MUST interpret ALL tool results into natural, readable language. Never just say "Done."

${FORMAT_DIRECTIVE}`;

    // Base conversation (single system at the very beginning)
    const baseMessages = buildConversation(
      enhancedSystemPrompt,
      history,
      query
    );

    const BUDGET_PLAN = getEnvInt("THINKING_BUDGET_PLAN");
    const BUDGET_EXECUTE = getEnvInt(
      "THINKING_BUDGET_EXECUTE",
      looksDbRelated(query) ? 512 : 256
    );
    const BUDGET_RETRY = getEnvInt("THINKING_BUDGET_RETRY");
    const BUDGET_INTERPRET = getEnvInt("THINKING_BUDGET_INTERPRET");

    const plannedToolNames = await planTools(
      model,
      [...sanitizeHistory(history), { role: "user", content: query }],
      safeTools,
      buildProviderOptions(BUDGET_PLAN)
    );

    const execTools = filterTools(safeTools, plannedToolNames);

    // EXECUTE (agentic, auto tool calls)
    const timeoutMs = Number(process.env.CHATBOT_RESPONSE_TIMEOUT_MS);
    const runGen = withTimeout(
      (signal) =>
        generateText({
          model,
          messages: baseMessages,
          tools: execTools,
          maxToolRoundtrips: 16,
          signal,
          providerOptions: buildProviderOptions(BUDGET_EXECUTE),
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
        `${AGENT_POLICY}\n${DOMAIN ? DOMAIN + "\n" : ""}
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
        providerOptions: buildProviderOptions(BUDGET_RETRY),
      });
    }

    // Check if response is too minimal and force re-interpretation
    let finalText = (result?.text || "").trim();

    if (
      finalText.toLowerCase() === "done" ||
      finalText.toLowerCase() === "done." ||
      finalText.length < 20
    ) {
      // If we have tool results but minimal text, force the model to interpret them
      if (result.toolResults && result.toolResults.length > 0) {
        const interpretMessages = [
          {
            role: "system",
            content: `You just executed tools but provided a minimal response. 
You MUST now interpret the tool results into natural language.
${FORMAT_DIRECTIVE}

Tool results to interpret: ${JSON.stringify(result.toolResults)}

Provide a detailed, natural language explanation of what was found.`,
          },
          {
            role: "user",
            content: `Please explain what you found from the ${query}`,
          },
        ];

        const interpretResult = streamText({
          model,
          messages: interpretMessages,
          tools: {}, // No tools for interpretation phase
          providerOptions: buildProviderOptions(BUDGET_INTERPRET),
        });

        let interpretText = "";
        for await (const delta of interpretResult.textStream) {
          interpretText += delta;
        }

        finalText = interpretText || finalText;
      }
    }

    // Use fallback if still minimal
    finalText = ensureMeaningfulResponse(finalText, result.toolResults);

    // Parse optional reasoning/content blocks from a single model response
    const extractBetween = (text, startTag, endTag) => {
      const start = text.indexOf(startTag);
      const end = text.indexOf(endTag);
      if (start !== -1 && end !== -1 && end > start) {
        return text.slice(start + startTag.length, end).trim();
      }
      return null;
    };

    const reasoningText = extractBetween(finalText, '<REASONING>', '</REASONING>');
    const contentText = extractBetween(finalText, '<CONTENT>', '</CONTENT>') || finalText;

    if (streamMode) {
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            // Stream the assistant content as NDJSON chunks
            const chunkSize = 30; // characters per chunk for smoother UI
            for (let i = 0; i < contentText.length; i += chunkSize) {
              const part = contentText.slice(i, i + chunkSize);
              const line = JSON.stringify({ type: "content", delta: part }) + "\n";
              controller.enqueue(encoder.encode(line));
              // small pacing to allow UI updates
              await new Promise((r) => setTimeout(r, 10));
            }

            // Stream reasoning if present (same model call output)
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "reasoning", content: reasoningText || null }) + "\n"
              )
            );

            // Diagnostics (optional)
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "meta",
                  plannedTools: plannedToolNames,
                  toolCalls: result.toolCalls || [],
                }) + "\n"
              )
            );

            controller.enqueue(encoder.encode(JSON.stringify({ type: "done" }) + "\n"));
            controller.close();
          } catch (e) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "error", error: e?.message || "stream error" }) + "\n")
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming JSON response (single call output)
    return NextResponse.json({
      result: contentText,
      reasoning: reasoningText,
      plannedTools: plannedToolNames,
      toolCalls: result.toolCalls || [],
      toolResults: result.toolResults || [],
    });
  } catch (err) {
    const isAbort = err?.name === "AbortError";
    return NextResponse.json(
      {
        error: isAbort
          ? "Timed out waiting for model/tools"
          : err?.message || "Internal Error",
      },
      { status: 500 }
    );
  } finally {
    if (resources?.closeAll) {
      try {
        await resources.closeAll();
      } catch {}
    }
  }
}
