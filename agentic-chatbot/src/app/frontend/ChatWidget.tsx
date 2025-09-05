import { useMemo, useRef, useState, useEffect } from "react";
import {
  Avatar,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Fab,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  Fade,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import ChatIcon from "@mui/icons-material/Chat";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import { Button } from "@mui/material";
import ReactMarkdown from "react-markdown";

type ChatMessage = {
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
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const items: string[] = [];
    
    for (const line of lines) {
      // Match patterns like: "1.  question", "2.  question", "- question", "* question"
      const m = line.match(/^(?:\d+\.\s+|[-*]\s+)(.*)$/);
      if (m && m[1]) {
        const question = m[1].trim();
        // Only add if it looks like a question (ends with ?) or is a meaningful follow-up
        if (question.endsWith('?') || question.length > 10) {
          items.push(question);
        }
      }
    }
    
    // If no numbered items found, try to extract from markdown format
    if (items.length === 0) {
      const markdownMatch = raw.match(/\*\*What would you like to explore next\?\*\*([\s\S]*?)$/);
      if (markdownMatch && markdownMatch[1]) {
        const followUpSection = markdownMatch[1];
        const followUpLines = followUpSection.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of followUpLines) {
          const m = line.match(/^(?:\d+\.\s+|[-*]\s+)(.*)$/);
          if (m && m[1]) {
            const question = m[1].trim();
            if (question.endsWith('?') || question.length > 10) {
              items.push(question);
            }
          }
        }
      }
    }
    
    return Array.from(new Set(items));
  };

  const handleFollowUpClick = (q: string) => {
    setInput(q);
    // Send immediately like a predefined prompt
    setTimeout(() => {
      handleSend();
    }, 0);
  };

  const handleAccordionToggle = (messageId: string) => {
    setExpandedAccordions(prev => {
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
    text: "I'm here to help answer questions specifically about CloudTuner, which is a fast and easy-to-use library for LLM inference and serving.",
    reasoning: "I have looked down the resources like aws cloud and 31 more to found specific and accurate results",
    timestamp: new Date(),
  });
  const [open, setOpen] = useState<boolean>(false);
  const [input, setInput] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createWelcomeMessage(),
  ]);
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(new Set());
  
  // MCP status (providers map from /api/mcp-status)
  const [mcpStatus, setMcpStatus] = useState({ 
    checking: true, 
    connected: false, 
    totalTools: 0, 
    tools: [], 
    error: null 
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
  const CHAT_MIN_HEIGHT = 110;
  const CHAT_MAX_HEIGHT = 400;
  const [chatBodyHeight, setChatBodyHeight] = useState<number>(CHAT_MIN_HEIGHT);

  // Auto-scroll to bottom with smooth animation
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, open]);

  // Dynamically size the chat body based on content
  useEffect(() => {
    if (!listRef.current) return;
    const contentHeight = listRef.current.scrollHeight;
    console.log(contentHeight)
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
  }, [open]);

  // Poll MCP status
  useEffect(() => {
    let stopped = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/mcp-status');
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
            error: data?.ok ? null : (data?.error || 'Unknown error'),
          });
        }
      } catch (e) {
        if (!stopped) {
          setMcpStatus({
            checking: false,
            connected: false,
            totalTools: 0,
            tools: [],
            error: 'Unable to reach /api/mcp-status',
          });
        }
      }
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => { stopped = true; clearInterval(id); };
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

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const history = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role, content: m.text }));

      const res = await fetch('/api/chatbot?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, messages: history }),
      });

      if (!res.ok) {
        let errText = 'Request failed';
        try { const j = await res.json(); errText = j?.error || errText; } catch {}
        throw new Error(errText);
      }

      // Insert placeholder assistant message to stream into
      const assistantId = generateId();
      const assistantIndexRef = { index: -1 };
      setMessages((prev) => {
        const idx = prev.length;
        assistantIndexRef.index = idx;
        return [...prev, { 
          id: assistantId,
          role: 'assistant', 
          text: '', 
          reasoning: "",
          followUps: [],
          timestamp: new Date()
        }];
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line) return;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'content' && typeof evt.delta === 'string') {
            setMessages((prev) => {
              const copy = [...prev];
              const idx = assistantIndexRef.index >= 0 ? assistantIndexRef.index : (copy.length - 1);
              const current = copy[idx] || { id: assistantId, role: 'assistant', text: '', reasoning: "", followUps: [], timestamp: new Date() };
              copy[idx] = { ...current, text: (current.text || '') + evt.delta };
              return copy;
            });
          } else if (evt.type === 'reasoning') {
            setMessages((prev) => {
              const copy = [...prev];
              const idx = assistantIndexRef.index >= 0 ? assistantIndexRef.index : (copy.length - 1);
              const current = copy[idx] || { id: assistantId, role: 'assistant', text: '', reasoning: "", followUps: [], timestamp: new Date() };
              copy[idx] = { ...current, reasoning: evt.content || "" };
              return copy;
            });
          } else if (evt.type === 'followupquestion' && typeof evt.delta === 'string') {
            setMessages((prev) => {
              const copy = [...prev];
              const idx = assistantIndexRef.index >= 0 ? assistantIndexRef.index : (copy.length - 1);
              const current = copy[idx] || { id: assistantId, role: 'assistant', text: '', reasoning: "", followUps: [], timestamp: new Date() };
              // Accumulate follow-up text in a separate field and derive follow-ups from it
              const followUpText = (current as any).followUpText || '';
              const newFollowUpText = followUpText + evt.delta;
              const followUps = deriveFollowUps(newFollowUpText);
              copy[idx] = { ...current, followUps, followUpText: newFollowUpText };
              return copy;
            });
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Stream error');
          }
        } catch (e) {
          console.error('Error parsing stream line:', e);
        }
      };

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          processLine(line);
        }
      }
    } catch (err) {
      console.error('Error in handleSend:', err);
      setMessages((prev) => [...prev, { 
        id: generateId(),
        role: 'assistant', 
        text: `Error: ${err instanceof Error ? err.message : 'Something went wrong.'}`,
        reasoning: "",
        followUps: [],
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };


  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
            right: 24,
            bottom: 24,
            zIndex: 1200,
            background: "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
            "&:hover": {
              background: "linear-gradient(135deg, #1565c0 0%, #6a1b9a 100%)",
              transform: "scale(1.05)",
            },
            transition: "all 0.3s ease",
            boxShadow: "0 8px 25px rgba(25, 118, 210, 0.3)",
          }}
        >
          <ChatIcon />
        </Fab>
      </Tooltip>

      {/* Chat Dialog */}
      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="sm"
        slots={{ transition: Fade}}
        sx={{
          "& .MuiDialog-paper": {
            borderRadius: 3,
            boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
            overflow: "hidden",
          },
        }}
      >
        {/* Enhanced Header */}
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            pr: 6,
            pb: 2,
            background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ position: "relative" }}>
              <Avatar
                sx={{
                  width: 48,
                  height: 48,
                  background:
                    "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
                  fontSize: "1.1rem",
                  fontWeight: 600,
                }}
              >
                AI
              </Avatar>
              <Box
                sx={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  width: 16,
                  height: 16,
                  bgcolor: mcpStatus.checking 
                    ? "warning.main" 
                    : mcpStatus.connected 
                      ? "success.main" 
                      : "error.main",
                  borderRadius: "50%",
                  border: "2px solid white",
                  animation: mcpStatus.checking 
                    ? "pulse 1s infinite" 
                    : mcpStatus.connected 
                      ? "pulse 2s infinite" 
                      : "none",
                  transition: "all 0.3s ease",
                }}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="h6"
                fontWeight={600}
                sx={{ color: "text.primary" }}
              >
                FinOps Assistant
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Can I assist you with anything?
              </Typography>
            </Box>
          </Stack>
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={resetChat}
            sx={{
              position: "absolute",
              right: 52,
              top: 10,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              lineHeight: 1.2,
              px: 1,
              py: 1,
              boxShadow: "0 2px 8px rgba(25,118,210,0.25)",
              background: "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
              marginRight: 1,
            }}
          >
            New chat
          </Button>
          <IconButton
            onClick={handleClose}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              bgcolor: "action.hover",
              "&:hover": {
                bgcolor: "action.selected",
                transform: "scale(1.1)",
              },
              transition: "all 0.2s ease",
            }}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 2, pb: 2, px: 0 }}>
          <Stack spacing={2}>
            {/* Messages Container */}
            <Box
              ref={listRef}
              sx={{
                height: chatBodyHeight,
                overflowY: "auto",
                px: 0,
                py: 1,
                bgcolor: "transparent",
                scrollBehavior: "smooth",
                transition: "height 0.3s ease",
                "&::-webkit-scrollbar": {
                  width: "6px",
                },
                "&::-webkit-scrollbar-track": {
                  background: "transparent",
                },
                "&::-webkit-scrollbar-thumb": {
                  backgroundColor: "rgba(0,0,0,0.2)",
                  borderRadius: "3px",
                },
                "&::-webkit-scrollbar-thumb:hover": {
                  backgroundColor: "rgba(0,0,0,0.3)",
                },
              }}
            >
              <Stack spacing={1}>
                {messages.map((msg, index) => (
                  <Fade in={true} timeout={300 + index * 100} key={msg.id}>
                    <Stack
                      direction="row"
                      justifyContent="flex-start"
                      alignItems="flex-start"
                      spacing={0}
                    >
                      <Box sx={{ width: "100%" }}>
                        <Paper
                          elevation={0}
                          sx={{
                            px: 2,
                            py: 1.5,
                            bgcolor:
                              msg.role === "user" ? "grey.200" : "transparent",
                            color: "text.primary",
                            borderRadius: 0,
                            boxShadow: "none",
                            border: "none",
                            display: "flex",
                            gap: "10px"
                          }}
                        >
                            <Box sx={{
                                marginTop: "2.5px"
                            }}>
                                <ChatBubbleOutlineIcon fontSize="small" htmlColor={msg.role === "user" ? "#0A40FF": "#999"} />
                            </Box>
                            <Box>
                            {index !== 0 && msg.role === "assistant" && msg.reasoning && (
                           <Accordion
                           disableGutters
                           elevation={0}
                           square
                           expanded={expandedAccordions.has(msg.id)}
                           onChange={() => handleAccordionToggle(msg.id)}
                           sx={{
                             boxShadow: "none",
                             "&:before": {
                               display: "none",
                             },
                             "&.Mui-expanded": {
                               margin: 0,
                               boxShadow: "none",
                               border: "none",
                             },
                             "& .MuiAccordionSummary-root": {
                               minHeight: "unset",
                               padding: 0.6,
                               "&.Mui-expanded": {
                                 minHeight: "unset",
                                 border: "none",
                                 margin: 'auto', // Adjust margin when expanded to remove gaps
                               },
                             },
                             "& .MuiAccordionSummary-content": {
                               margin: 0,
                               display: "flex",
                               alignItems: "center",
                               gap: "0.25rem", // spacing between text & icon
                               "&.Mui-expanded": {
                                 margin: 0,
                               },
                             },
                             "& .MuiAccordionDetails-root": {
                               padding: 0,
                               marginTop: "0.25rem",
                             },
                             '&:not(:last-child)': {
                                borderBottom: 0, // Remove bottom border for all but the last
                              },
                              '&::before': {
                                display: 'none', // Remove default pseudo-element border
                              },
                           }}
                         >
                           <AccordionSummary>
                             <Typography
                               variant="body2"
                               sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5, color: "#6b7280", mt: -0.5}}
                             >
                               Reasoning
                             </Typography>
                             <ExpandMoreIcon
                               sx={{
                                 transition: "transform 0.2s ease-in-out",
                                 transform: expandedAccordions.has(msg.id) ? "rotate(180deg)" : "rotate(0deg)",
                                 color: "#6b7280",
                                 mt: -0.5
                               }}
                             />
                           </AccordionSummary>
                     
                           <AccordionDetails sx={{
                            marginBottom: 1
                           }}>
                             <Typography
                               variant="body2"
                               sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5, mt: -0.5, mb: 1.5, mx: 0.5, color: "gray" }}
                             >
                               {msg.reasoning}
                             </Typography>
                           </AccordionDetails>
                         </Accordion>
                            )}
                          <Box fontSize={14} sx={{ mt: index !== 0 && msg.role === "assistant" ? -2 : -1.5 }}>
                            <ReactMarkdown>
                              {msg.text || ""}
                            </ReactMarkdown>
                          </Box>
                          {msg.followUps && msg.followUps.length > 0 && (
                            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1, display: "flex", alignItems: "center" }}>
                              {msg.followUps.map((q, qi) => (
                                <Button
                                  key={qi}
                                  size="small"
                                  variant="contained"
                                  color="secondary"
                                  onClick={() => handleFollowUpClick(q)}
                                  sx={{
                                    textTransform: "none",
                                    borderRadius: 2,
                                    background: "linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)",
                                    textWrap: "nowrap"
                                  }}
                                >
                                  {q}
                                </Button>
                              ))}
                            </Stack>
                          )}
                          {msg.timestamp && (                                           
                            <Typography
                              variant="caption"
                              sx={{
                                display: "block",
                                mt: 0.5,
                                opacity: 0.7,
                                fontSize: "0.7rem",
                              }}
                            >
                              {msg.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                                </Typography>
                            )}
                            </Box>
                        </Paper>
                      </Box>

                      {/* Avatars removed to make messages full-width and left-aligned */}
                    </Stack>
                  </Fade>
                ))}

                {/* Typing Indicator */}
                {isTyping && (
                  <Fade in={true}>
                    <Stack
                      direction="row"
                      justifyContent="flex-start"
                      alignItems="flex-start"
                      spacing={0}
                    >
                      <Paper
                        elevation={0}
                        sx={{
                          px: 2,
                          py: 1.5,
                          bgcolor: "transparent",
                          borderRadius: 0,
                          boxShadow: "none",
                          border: "none",
                          display: "flex",
                          gap: 2
                        }}
                      >
                        <ChatBubbleOutlineIcon fontSize="small" htmlColor="#999" />
                        <Box sx={{
                          display: "flex",
                          gap: 1
                        }}>
                        <Stack
                          direction="row"
                          spacing={0.5}
                          alignItems="center"
                        >
                          {[0, 1, 2].map((i) => (
                            <Box
                              key={i}
                              sx={{
                                width: 6,
                                height: 6,
                                bgcolor: "grey.400",
                                borderRadius: "50%",
                                animation:
                                  "bounce 1.4s ease-in-out infinite both",
                                animationDelay: `${i * 0.16}s`,
                                "@keyframes bounce": {
                                  "0%, 80%, 100%": {
                                    transform: "scale(0)",
                                  },
                                  "40%": {
                                    transform: "scale(1)",
                                  },
                                },
                              }}
                            />
                          ))}
                        </Stack>
                        <Typography fontSize={14}>
                          Typing...
                        </Typography>
                        </Box>
                      </Paper>
                    </Stack>
                  </Fade>
                )}
              </Stack>
            </Box>

            {/* Enhanced Input Area */}
            <Box sx={{ mt: 1 }}>
              <Paper
                variant="outlined"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 2,
                  py: 0.5,
                  mx: 2,
                  borderRadius: 3,
                  bgcolor: "grey.50",
                  border: "2px solid",
                  borderColor: "divider",
                  "&:focus-within": {
                    borderColor: "primary.main",
                    boxShadow: "0 0 0 3px rgba(25, 118, 210, 0.1)",
                  },
                  transition: "all 0.2s ease",
                  minHeight: 48,
                }}
              >
                <TextField
                  multiline
                  minRows={1}
                  maxRows={8}
                  placeholder="Ask a follow-up question..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  variant="standard"
                  InputProps={{
                    disableUnderline: true,
                  }}
                  sx={{
                    flex: 1,
                    "& .MuiInputBase-input": {
                      fontSize: "0.95rem",
                      lineHeight: 1.6,
                      py: 0.5,
                      pl: 1.25,
                      pr: 1.25,
                      transition: "height 0.2s ease",
                    },
                  }}
                />
                <IconButton
                  onClick={handleSend}
                  disabled={!canSend || isTyping}
                  sx={{
                    ml: 1,
                    p: 1,
                    bgcolor:
                      canSend && !isTyping ? "primary.main" : "action.disabled",
                    color:
                      canSend && !isTyping
                        ? "primary.contrastText"
                        : "action.disabled",
                    "&:hover": {
                      bgcolor:
                        canSend && !isTyping
                          ? "primary.dark"
                          : "action.disabled",
                      transform: canSend && !isTyping ? "scale(1.05)" : "none",
                    },
                    "&:disabled": {
                      bgcolor: "action.disabled",
                      color: "action.disabled",
                    },
                    borderRadius: 2,
                    transition: "all 0.2s ease",
                    boxShadow:
                      canSend && !isTyping
                        ? "0 2px 8px rgba(25, 118, 210, 0.3)"
                        : "none",
                  }} 
                  aria-label="send"
                >
                  <SendIcon sx={{ fontSize: "1.1rem" }} />
                </IconButton>
              </Paper>
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
