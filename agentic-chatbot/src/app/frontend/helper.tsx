import {
  Avatar,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Typography,
  Fade,
  TextField,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import { Button } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RefObject } from "react";
import { ChatMessage } from "./ChatWidget";

function TableComponent({ children, ...props }) {
  return (
    <div className="table-wrapper bubble">
      <table {...props}>{children}</table>
    </div>
  );
}

function TableCellComponent({
  children,
  ...props
}: {
  children?: any;
  [key: string]: any;
}) {
  const cellText = String(children || "");
  const isNumeric =
    /^[\d\s,.-]+$/.test(cellText.trim()) && cellText.trim() !== "";

  return (
    <td {...props} data-numeric={isNumeric ? "true" : "false"}>
      {children}
    </td>
  );
}

function TableHeaderComponent({
  children,
  ...props
}: {
  children?: any;
  [key: string]: any;
}) {
  return <th {...props}>{children}</th>;
}

interface ChatProps {
  open: boolean;
  handleClose: () => void;
  mcpStatus: {
    checking: boolean;
    connected: boolean;
    totalTools: number;
    tools: any[];
    error: any;
  };
  resetChat: () => void;
  listRef: RefObject<HTMLDivElement>;
  chatBodyHeight: number;
  messages: ChatMessage[];
  expandedAccordions: Set<string>;
  handleAccordionToggle: (messageId: string) => void;
  extractFollowUpHeading: (raw: string) => string | null;
  handleFollowUpClick: (q: string) => void;
  isTyping: boolean;
  canSend: boolean;
  handleSend: () => Promise<void>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export default function ChatDialog({
  open,
  handleClose,
  mcpStatus,
  resetChat,
  listRef,
  chatBodyHeight,
  messages,
  expandedAccordions,
  handleAccordionToggle,
  extractFollowUpHeading,
  handleFollowUpClick,
  isTyping,
  canSend,
  handleSend,
  input,
  setInput,
  handleKeyDown,
}: ChatProps) {
  const isNarrow468 = useMediaQuery("(max-width:468px)");
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      slots={{ transition: Fade }}
      sx={{
        "& .MuiPaper-root": {
          maxWidth: {
            xs: "100%",
            sm: 740,
          },
        },
        "& .MuiDialog-paper": {
          borderRadius: 3,
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15)",
          overflow: "hidden",
          m: { xs: 2, sm: 3 },
          maxHeight: { xs: "calc(100% - 32px)", sm: "calc(100% - 48px)" },
        },
      }}
    >
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
                background: "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
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
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={resetChat}
            sx={{
              position: "absolute",
              right: 65,
              top: 15,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              lineHeight: 1.2,
              px: 1,
              py: 1,
              boxShadow: "0 2px 8px rgba(25,118,210,0.25)",
              background: "linear-gradient(135deg, #1976d2 0%, #7b1fa2 100%)",
              display: { xs: "none", sm: "inline-flex" },
            }}
          >
            New chat
          </Button>
          <IconButton
            onClick={resetChat}
            sx={{
              position: "absolute",
              right: 58,
              top: 14,
              bgcolor: "action.hover",
              display: { xs: "inline-flex", sm: "none" },
              "&:hover": {
                bgcolor: "action.selected",
                transform: "scale(1.05)",
              },
              transition: "all 0.2s ease",
            }}
            aria-label="new-chat"
          >
            <AddIcon />
          </IconButton>
          <IconButton
            onClick={handleClose}
            sx={{
              position: "absolute",
              right: 8,
              top: 14,
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
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 2, pb: 2, px: 0 }}>
        <Stack spacing={2}>
          <Box
            ref={listRef}
            sx={{
              height: chatBodyHeight,
              overflowY: "auto",
              px: 0,
              py: 1,
              bgcolor: "transparent",
              scrollBehavior: "auto",
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
              {messages.map((msg, index) => {
                const content = (
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
                          gap: "10px",
                        }}
                      >
                        <Box
                          sx={{
                            marginTop: "2.5px",
                          }}
                        >
                          <ChatBubbleOutlineIcon
                            fontSize="small"
                            htmlColor={msg.role === "user" ? "#0A40FF" : "#999"}
                          />
                        </Box>
                        <Box>
                          {index !== 0 &&
                            msg.role === "assistant" &&
                            msg.reasoning && (
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
                                      margin: "auto", 
                                    },
                                  },
                                  "& .MuiAccordionSummary-content": {
                                    margin: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.25rem", 
                                    "&.Mui-expanded": {
                                      margin: 0,
                                    },
                                  },
                                  "& .MuiAccordionDetails-root": {
                                    padding: 0,
                                    marginTop: "0.25rem",
                                  },
                                  "&:not(:last-child)": {
                                    borderBottom: 0, 
                                  },
                                  "&::before": {
                                    display: "none", 
                                  },
                                }}
                              >
                                <AccordionSummary>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      whiteSpace: "pre-wrap",
                                      lineHeight: 1.5,
                                      color: "#6b7280",
                                      mt: -0.5,
                                      fontStyle: "italic",
                                    }}
                                  >
                                    Reasoning
                                  </Typography>
                                  <ExpandMoreIcon
                                    sx={{
                                      transition: "transform 0.2s ease-in-out",
                                      transform: expandedAccordions.has(msg.id)
                                        ? "rotate(180deg)"
                                        : "rotate(0deg)",
                                      color: "#6b7280",
                                      mt: -0.5,
                                    }}
                                  />
                                </AccordionSummary>

                                <AccordionDetails
                                  sx={{
                                    marginBottom: 1,
                                  }}
                                >
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      whiteSpace: "pre-wrap",
                                      lineHeight: 1.5,
                                      mt: -0.5,
                                      mb: 1.5,
                                      mx: 0.5,
                                      color: "gray",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    {msg.reasoning}
                                  </Typography>
                                </AccordionDetails>
                              </Accordion>
                            )}
                          <Box
                            fontSize={14}
                            sx={{ mt: index !== 0 ? -1.5 : -1.3 }}
                          >
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                table: TableComponent,
                                th: (p) => <TableHeaderComponent {...p} />,
                                td: (p) => <TableCellComponent {...p} />,
                                a: (props) => (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                ),
                              }}
                            >
                              {msg.text || ""}
                            </ReactMarkdown>
                          </Box>
                          {(msg.followUpText || (msg as any).followUpText) &&
                            (() => {
                              const heading = extractFollowUpHeading(
                                (msg as any).followUpText || ""
                              );
                              return heading ? (
                                <Box sx={{ mt: 1, mb: 0.5 }}>
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {heading}
                                  </ReactMarkdown>
                                </Box>
                              ) : null;
                            })()}

                          {msg.followUps && msg.followUps.length > 0 && (
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{
                                mt: 1,
                                gap: 1,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "start",
                                justifyContent: "start",
                                width: "100%",
                              }}
                            >
                              {msg.followUps.map((q, qi) => (
                                <Button
                                  key={qi}
                                  size="small"
                                  variant="contained"
                                  color="secondary"
                                  onClick={() => handleFollowUpClick(q)}
                                  fullWidth={isNarrow468}
                                  style={{
                                    marginLeft: 0,
                                  }}
                                  sx={{
                                    textTransform: "none",
                                    borderRadius: 2,
                                    border: "1px solid #6a11cb",
                                    background: "white",
                                    ":hover": {
                                      background: "#F0F0F0",
                                    },
                                    color: "#6a11cb",
                                    whiteSpace: "normal",
                                    wordBreak: {
                                      xs: "break-word",
                                      sm: "normal",
                                    },
                                    overflowWrap: "anywhere",
                                    maxWidth: "100%",
                                    textAlign: "left",
                                    fontSize: { xs: "0.85rem", sm: "0.9rem" },
                                    py: { xs: 0.5, sm: 0.75 },
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
                                marginTop: msg.followUps ? 2 : -1,
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

                  </Stack>
                );
                return msg.role === "assistant" ? (
                  <Fade in={true} timeout={800} key={msg.id}>
                    {content}
                  </Fade>
                ) : (
                  <Box key={msg.id}>{content}</Box>
                );
              })}

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
                        gap: 2,
                      }}
                    >
                      <ChatBubbleOutlineIcon
                        fontSize="small"
                        htmlColor="#999"
                      />
                      <Box
                        sx={{
                          display: "flex",
                          gap: 1,
                        }}
                      >
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
                        <Typography fontSize={14}>Thinking...</Typography>
                      </Box>
                    </Paper>
                  </Stack>
                </Fade>
              )}
            </Stack>
          </Box>

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
                placeholder={
                  messages && messages.length > 1
                    ? "Ask a follow up question..."
                    : "Type your message..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                variant="standard"
                slotProps={{
                  input: { disableUnderline: true },
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
                    bgcolor: "transparent",
                    scrollBehavior: "smooth",
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
                      canSend && !isTyping ? "primary.dark" : "action.disabled",
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
  );
}
