import { NextResponse } from "next/server";
import { google } from "@ai-sdk/google";
import { streamText } from "ai";
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

// --- Configuration ---
const CONFIG = {
  TIMEOUT_MS: Number(process.env.CHATBOT_RESPONSE_TIMEOUT_MS) || 30000,
  MODEL_PRO: process.env.GOOGLE_GEMINI_MODEL,
  MODEL_FLASH: process.env.GOOGLE_GEMINI_FLASH_MODEL,
  CHUNK_SIZE: 30,
  STREAM_DELAY: 10,
  MAX_TOOL_ROUNDS: 3,
};

const BUDGETS = {
  PLAN: getEnvInt("THINKING_BUDGET_PLAN"),
  EXECUTE: getEnvInt("THINKING_BUDGET_EXECUTE"),
  RETRY: getEnvInt("THINKING_BUDGET_RETRY"),
  INTERPRET: getEnvInt("THINKING_BUDGET_INTERPRET"),
};

const SYSTEM_PROMPTS = {
  base: (domain, availableTools, toolsWereExecuted) => {
    const followUpInstruction = toolsWereExecuted
      ? "\n\nIMPORTANT: Since database tools were executed in this response, include 1-3 relevant follow-up questions based on the NEW data retrieved."
      : "\n\nIMPORTANT: No database tools were executed in this response. Do NOT include any follow-up questions.";

    return `${AGENT_POLICY}
${domain ? domain + "\n" : ""}
Available tools: ${Object.keys(availableTools).join(", ") || "None"}

REMEMBER: You MUST interpret ALL tool results into natural, readable language. Never just say "Done."

${FORMAT_DIRECTIVE}${followUpInstruction}`;
  },

  forced: (basePrompt) => `${basePrompt}
CRITICAL: This query is database-related. You MUST:
1. Call at least one MCP tool
2. Interpret ALL results into natural language
3. NEVER just say "Done"`,

  interpret: (
    toolResults
  ) => `You just executed tools but provided a minimal response. 
You MUST now interpret the tool results into natural language.
${FORMAT_DIRECTIVE}

Tool results to interpret: ${JSON.stringify(toolResults)}

Provide a detailed, natural language explanation of what was found.
Include 1-3 follow-up questions since tools were executed.`,
};

// --- Utilities ---
function getEnvInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function withTimeout(promiseFactory, ms) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), ms);

  return {
    run: async () => {
      try {
        return await promiseFactory(ac.signal);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

const buildProviderOptions = (budget) => ({
  google: {
    generationConfig: {
      thinkingConfig: { thinkingBudget: budget },
    },
  },
});

const sanitizeHistory = (msgs = []) =>
  msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }));

const buildConversation = (systemText, history, userQuery) => [
  { role: "system", content: systemText },
  ...sanitizeHistory(history),
  { role: "user", content: userQuery },
];

const extractBetween = (text, startTag, endTag) => {
  const start = text.indexOf(startTag);
  const end = text.indexOf(endTag);
  return start !== -1 && end !== -1 && end > start
    ? text.slice(start + startTag.length, end).trim()
    : null;
};

const isMinimalResponse = (text) => {
  const cleaned = text.toLowerCase().trim();
  return cleaned === "done" || cleaned === "done." || text.length < 20;
};

const hasToolCalls = (result) =>
  result.toolCalls && result.toolCalls.length > 0;

const requiresTools = (query, availableTools) => {
  if (Object.keys(availableTools).length === 0) return false;

  return (
    looksDbRelated(query) ||
    /\b(find|search|list|show|get|retrieve|query|count|aggregate|stats|analyze)\b/i.test(
      query
    )
  );
};

const getModel = (modelType) =>
  google(modelType === "pro" ? CONFIG.MODEL_PRO : CONFIG.MODEL_FLASH);

// --- Core Logic ---
async function generateResponse(modelType, messages, tools, budget, signal) {
  const model = getModel(modelType);

  const { textStream, toolCalls, toolResults } = streamText({
    model,
    messages,
    tools,
    maxToolRoundtrips: CONFIG.MAX_TOOL_ROUNDS,
    abortSignal: signal,
    experimental_providerOptions: buildProviderOptions(budget),
  });

  // Collect the full text from the stream
  let text = "";
  for await (const chunk of textStream) {
    text += chunk;
  }

  return {
    text,
    toolCalls: await toolCalls,
    toolResults: await toolResults,
  };
}

async function retryWithForce(
  baseSystemPrompt,
  history,
  query,
  execTools,
  signal
) {
  const forcedMessages = buildConversation(
    SYSTEM_PROMPTS.forced(baseSystemPrompt),
    history,
    query
  );

  return generateResponse(
    "pro",
    forcedMessages,
    execTools,
    BUDGETS.RETRY,
    signal
  );
}

async function interpretResults(query, toolResults) {
  const interpretMessages = [
    {
      role: "system",
      content: SYSTEM_PROMPTS.interpret(toolResults),
    },
    {
      role: "user",
      content: `Please explain what you found from the ${query}`,
    },
  ];

  const { textStream } = streamText({
    model: getModel("gemini-2.5-flash"),
    messages: interpretMessages,
    tools: {},
    experimental_providerOptions: buildProviderOptions(BUDGETS.INTERPRET),
  });

  let interpreted = "";
  for await (const chunk of textStream) {
    interpreted += chunk;
  }

  return interpreted;
}

async function createStreamResponse(
  contentText,
  reasoningText,
  plannedTools,
  result,
  toolsExecuted
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Detect and split follow-up questions from main content
        const FOLLOWUP_MARKER = "**What would you like to explore next?**";
        let mainText = contentText;
        let followupText = "";
        const idx = contentText.indexOf(FOLLOWUP_MARKER);
        if (idx !== -1) {
          mainText = contentText.slice(0, idx).trimEnd();
          followupText = contentText.slice(idx).trimStart();
        }

        // Stream main content in chunks
        for (let i = 0; i < mainText.length; i += CONFIG.CHUNK_SIZE) {
          const part = mainText.slice(i, i + CONFIG.CHUNK_SIZE);
          const line = JSON.stringify({ type: "content", delta: part }) + "\n";
          controller.enqueue(encoder.encode(line));
          await new Promise((r) => setTimeout(r, CONFIG.STREAM_DELAY));
        }

        // Stream follow-up questions (if present) with a different type
        if (followupText) {
          for (let i = 0; i < followupText.length; i += CONFIG.CHUNK_SIZE) {
            const part = followupText.slice(i, i + CONFIG.CHUNK_SIZE);
            const line =
              JSON.stringify({ type: "followupquestion", delta: part }) + "\n";
            controller.enqueue(encoder.encode(line));
            await new Promise((r) => setTimeout(r, CONFIG.STREAM_DELAY));
          }
        }

        // Stream metadata
        const metadata = [
          { type: "reasoning", content: reasoningText || null },
          {
            type: "meta",
            plannedTools,
            toolCalls: result.toolCalls || [],
            toolsExecuted,
          },
          { type: "done" },
        ];

        metadata.forEach((data) => {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        });

        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "error",
              error: e?.message || "stream error",
            }) + "\n"
          )
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

function validateRequest(body) {
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const history = Array.isArray(body?.messages) ? body.messages : [];

  if (!query) {
    throw new Error('Invalid "query" provided');
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");
  }

  return { query, history };
}

function formatResponse(finalText, toolsExecuted) {
  if (toolsExecuted && finalText.indexOf("<CONTENT>") === -1) {
    return `<EXPLANATION>
Processing your request.
</EXPLANATION>

<CONTENT>
${finalText}
</CONTENT>`;
  }
  return finalText;
}

async function processWithTools(query, history, safeTools, domain) {
  const proModel = getModel("pro");

  // Plan tools
  const plannedToolNames = await planTools(
    proModel,
    [...sanitizeHistory(history), { role: "user", content: query }],
    safeTools,
    buildProviderOptions(BUDGETS.PLAN)
  );

  const execTools = filterTools(safeTools, plannedToolNames);
  const executeBudget = looksDbRelated(query) ? 128 : BUDGETS.EXECUTE;
  const systemPrompt = SYSTEM_PROMPTS.base(domain, execTools, false);

  // Generate with tools
  const runGen = withTimeout(
    (signal) =>
      generateResponse(
        "pro",
        buildConversation(systemPrompt, history, query),
        execTools,
        executeBudget,
        signal
      ),
    CONFIG.TIMEOUT_MS
  );

  let result = await runGen.run();
  let toolsExecuted = hasToolCalls(result);

  // Retry for DB queries without tool usage
  if (
    looksDbRelated(query) &&
    !toolsExecuted &&
    Object.keys(execTools).length > 0
  ) {
    const retryGen = withTimeout(
      (signal) =>
        retryWithForce(systemPrompt, history, query, execTools, signal),
      CONFIG.TIMEOUT_MS
    );
    result = await retryGen.run();
    toolsExecuted = hasToolCalls(result);
  }

  let finalText = (result?.text || "").trim();

  // Handle minimal responses with tool results
  if (isMinimalResponse(finalText) && result.toolResults?.length > 0) {
    const interpreted = await interpretResults(query, result.toolResults);
    finalText = (interpreted || finalText).trim();
  }

  finalText = ensureMeaningfulResponse(finalText, result.toolResults);

  return { result, finalText, toolsExecuted, plannedToolNames };
}

async function processWithoutTools(query, history, domain) {
  const systemPrompt = SYSTEM_PROMPTS.base(domain, {}, false);

  const runGen = withTimeout(
    (signal) =>
      generateResponse(
        "gemini-2.5-flash",
        buildConversation(systemPrompt, history, query),
        {},
        BUDGETS.EXECUTE,
        signal
      ),
    CONFIG.TIMEOUT_MS
  );

  const result = await runGen.run();
  const finalText = (result?.text || "").trim();

  return { result, finalText, toolsExecuted: false, plannedToolNames: [] };
}

// --- Main Handler ---
export async function POST(req) {
  let resources = null;

  try {
    const url = new URL(req.url);
    const streamMode = url.searchParams.get("stream") === "1";
    const body = await req.json();
    const { query, history } = validateRequest(body);

    const { tools: allTools, closeAll } = await loadAllMCPTools();
    resources = { closeAll };

    const safeTools = buildToolSet(allTools, query);
    const domain = loadDomainInstruction();
    const needsTools = requiresTools(query, safeTools);

    // Process request based on tool requirements
    const { result, finalText, toolsExecuted, plannedToolNames } =
      needsTools && Object.keys(safeTools).length > 0
        ? await processWithTools(query, history, safeTools, domain)
        : await processWithoutTools(query, history, domain);

    const formattedText = formatResponse(finalText, toolsExecuted);
    const reasoningText = extractBetween(
      formattedText,
      "<EXPLANATION>",
      "</EXPLANATION>"
    );
    const contentText =
      extractBetween(formattedText, "<CONTENT>", "</CONTENT>") || formattedText;

    if (streamMode) {
      return await createStreamResponse(
        contentText,
        reasoningText,
        plannedToolNames,
        result,
        toolsExecuted
      );
    }

    return NextResponse.json({
      result: contentText,
      reasoning: reasoningText,
      plannedTools: plannedToolNames,
      toolCalls: result?.toolCalls || [],
      toolResults: result?.toolResults || [],
      toolsExecuted,
      modelUsed: needsTools ? "gemini-2.5-pro" : "gemini-2.5-flash",
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
