import { useMemo, useRef, useState, useEffect } from "react";
import {
  Fab,
  Tooltip,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import ChatDialog from "./helper";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  reasoning: string;
  text: string;
  followUps?: string[];
  followUpText?: string;
  timestamp?: Date;
};

function generateId() {
  return Math.random().toString(36).slice(2);
}

export default function ChatWidget() {
  const deriveFollowUps = (raw: string): string[] => {
    if (!raw) return [];

    // Handle the API's follow-up question format
    // Look for patterns like "1.  See more details for a specific resource ID?"
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items: string[] = [];

    for (const line of lines) {
      // Match patterns like: "1.  question", "2.  question", "- question", "* question"
      const m = line.match(/^(?:\d+\.\s+|[-*]\s+)(.*)$/);
      if (m && m[1]) {
        const question = m[1].trim();
        // Only add if it looks like a question (ends with ?) or is a meaningful follow-up
        if (question.endsWith("?") || question.length > 10) {
          items.push(question);
        }
      }
    }

    // If no numbered items found, try to extract from markdown format
    if (items.length === 0) {
      const markdownMatch = raw.match(
        /\*\*What would you like to explore next\?\*\*([\s\S]*?)$/
      );
      if (markdownMatch && markdownMatch[1]) {
        const followUpSection = markdownMatch[1];
        const followUpLines = followUpSection
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of followUpLines) {
          const m = line.match(/^(?:\d+\.\s+|[-*]\s+)(.*)$/);
          if (m && m[1]) {
            const question = m[1].trim();
            if (question.endsWith("?") || question.length > 10) {
              items.push(question);
            }
          }
        }
      }
    }

    return Array.from(new Set(items));
  };

  const extractFollowUpHeading = (raw: string): string | null => {
    if (!raw) return null;
    // Extract the first bolded segment **...** from the streamed follow-up text
    const match = raw.match(/\*\*([\s\S]+?)\*\*/);
    return match ? `**${match[1].trim()}**` : null;
  };

  const handleFollowUpClick = (q: string) => {
    setInput(q);
  };

  const handleAccordionToggle = (messageId: string) => {
    setExpandedAccordions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  };
  const createWelcomeMessage = (): ChatMessage => ({
    id: generateId(),
    role: "assistant",
    text: "Welcome to FinOps Assistant! How can I help with your cloud costs today?",
    reasoning:
      "I have looked down the resources like aws cloud and 31 more to found specific and accurate results",
    timestamp: new Date(),
  });
  const [open, setOpen] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createWelcomeMessage(),
  ]);
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(
    new Set()
  );

  // MCP status (providers map from /api/mcp-status)
  const [mcpStatus, setMcpStatus] = useState({
    checking: true,
    connected: false,
    totalTools: 0,
    tools: [],
    error: null,
  });

  const resetChat = () => {
    setInput("");
    setIsTyping(false);
    setMessages([createWelcomeMessage()]);
    setChatBodyHeight(CHAT_MIN_HEIGHT);
  };

  const handleClose = () => {
    setOpen(false);
    setInput("");
  };

  const listRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef<boolean>(false);
  const CHAT_MIN_HEIGHT = 110;
  const CHAT_MAX_HEIGHT = 400;
  const [chatBodyHeight, setChatBodyHeight] = useState<number>(CHAT_MIN_HEIGHT);

  // Auto-scroll to bottom with smooth animation
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      autoScrollRef.current = false;
    }
  }, [messages]);

  // Dynamically size the chat body based on content
  useEffect(() => {
    if (!listRef.current) return;
    const contentHeight = listRef.current.scrollHeight;
    const clamped = Math.max(
      CHAT_MIN_HEIGHT,
      Math.min(contentHeight, CHAT_MAX_HEIGHT)
    );
    setChatBodyHeight(clamped);
  }, [messages, open]);

  // Ensure height resets to min on opening a cleared chat
  useEffect(() => {
    if (open && messages.length <= 1 && input === "") {
      setChatBodyHeight(CHAT_MIN_HEIGHT);
    }
  }, [open, messages, input]);

  // Poll MCP status
  useEffect(() => {
    let stopped = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/mcp-status");
        const data = await res.json();

        // New API shape: { ok, providers, totalTools }
        if (!stopped) {
          const providers = data?.providers || {};
          const toolList = Object.entries(providers).flatMap(([p, arr]) =>
            (Array.isArray(arr) ? arr : []).map((t: string) => `${p}.${t}`)
          );
          setMcpStatus({
            checking: false,
            connected: !!data?.ok && Number(data?.totalTools || 0) > 0,
            totalTools: Number(data?.totalTools || 0),
            tools: toolList,
            error: data?.ok ? null : data?.error || "Unknown error",
          });
        }
      } catch (e) {
        if (!stopped) {
          setMcpStatus({
            checking: false,
            connected: false,
            totalTools: 0,
            tools: [],
            error: "Unable to reach /api/mcp-status",
          });
        }
      }
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      reasoning: "",
      text: trimmed,
      timestamp: new Date(),
    };

    // Enable auto-scroll only when user submits a query
    autoScrollRef.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.text }));

      const res = await fetch("/api/chatbot?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, messages: history }),
      });

      if (!res.ok) {
        let errText = "Request failed";
        try {
          const j = await res.json();
          errText = j?.error || errText;
        } catch {}
        throw new Error(errText);
      }

      // Insert placeholder assistant message to stream into
      const assistantId = generateId();
      const assistantIndexRef = { index: -1 };
      setMessages((prev) => {
        const idx = prev.length;
        assistantIndexRef.index = idx;
        return [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            text: "",
            reasoning: "",
            followUps: [],
            timestamp: new Date(),
          },
        ];
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        if (!line) return;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "content" && typeof evt.delta === "string") {
            setMessages((prev) => {
              const copy = [...prev];
              const idx =
                assistantIndexRef.index >= 0
                  ? assistantIndexRef.index
                  : copy.length - 1;
              const current = copy[idx] || {
                id: assistantId,
                role: "assistant",
                text: "",
                reasoning: "",
                followUps: [],
                timestamp: new Date(),
              };
              copy[idx] = {
                ...current,
                text: (current.text || "") + evt.delta,
              };
              return copy;
            });
          } else if (evt.type === "reasoning") {
            // Update reasoning content and ensure the accordion is expanded by default
            setMessages((prev) => {
              const copy = [...prev];
              const idx =
                assistantIndexRef.index >= 0
                  ? assistantIndexRef.index
                  : copy.length - 1;
              const current = copy[idx] || {
                id: assistantId,
                role: "assistant",
                text: "",
                reasoning: "",
                followUps: [],
                timestamp: new Date(),
              };
              copy[idx] = { ...current, reasoning: evt.content || "" };
              return copy;
            });
            setExpandedAccordions((prev) => {
              const next = new Set(prev);
              const targetId = assistantId;
              next.add(targetId);
              return next;
            });
          } else if (
            evt.type === "followupquestion" &&
            typeof evt.delta === "string"
          ) {
            setMessages((prev) => {
              const copy = [...prev];
              const idx =
                assistantIndexRef.index >= 0
                  ? assistantIndexRef.index
                  : copy.length - 1;
              const current = copy[idx] || {
                id: assistantId,
                role: "assistant",
                text: "",
                reasoning: "",
                followUps: [],
                timestamp: new Date(),
              };
              // Accumulate follow-up text in a separate field and derive follow-ups from it
              const followUpText = (current as any).followUpText || "";
              const newFollowUpText = followUpText + evt.delta;
              const followUps = deriveFollowUps(newFollowUpText);
              copy[idx] = {
                ...current,
                followUps,
                followUpText: newFollowUpText,
              };
              return copy;
            });
          } else if (evt.type === "error") {
            throw new Error(evt.error || "Stream error");
          }
        } catch (e) {
          console.log("Error parsing stream line:", e);
        }
      };

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          processLine(line);
        }
      }
    } catch (err) {
      console.log("Error in handleSend:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          text: `Error: ${
            err instanceof Error ? err.message : "Something went wrong."
          }`,
          reasoning: "",
          followUps: [],
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isTyping) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = useMemo(() => input.trim().length > 0, [input]);

  return (
    <>
      {/* Floating Action Button */}
      <Tooltip title="FinOps Assistant" placement="left">
        <Fab
          color="primary"
          onClick={() => setOpen(true)}
          aria-label="ask-ai"
          sx={{
            position: "fixed",
            right: { xs: 16, sm: 24 },
            bottom: { xs: 16, sm: 24 },
            zIndex: 1200,
            background: "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
            width: { xs: 48, sm: 56 },
            height: { xs: 48, sm: 56 },
            minHeight: { xs: 48, sm: 56 },
            "& .MuiSvgIcon-root": { fontSize: { xs: 22, sm: 24 } },
            "&:hover": {
              background: "linear-gradient(135deg, #1565c0 0%, #6a1b9a 100%)",
              transform: { xs: "scale(1.03)", sm: "scale(1.05)" },
            },
            transition: "all 0.3s ease",
            boxShadow: {
              xs: "0 6px 18px rgba(25, 118, 210, 0.28)",
              sm: "0 8px 25px rgba(25, 118, 210, 0.3)",
            },
          }}
        >
          <ChatIcon />
        </Fab>
      </Tooltip>

      {/* Chat Dialog */}
      <ChatDialog
        open={open}
        handleClose={handleClose}
        mcpStatus={mcpStatus}
        resetChat={resetChat}
        listRef={listRef}
        chatBodyHeight={chatBodyHeight}
        messages={messages}
        expandedAccordions={expandedAccordions}
        handleAccordionToggle={handleAccordionToggle}
        extractFollowUpHeading={extractFollowUpHeading}
        handleFollowUpClick={handleFollowUpClick}
        isTyping={isTyping}
        canSend={canSend}
        handleSend={handleSend}
        input={input}
        setInput={setInput}
        handleKeyDown={handleKeyDown}
      />
    </>
  );
}
