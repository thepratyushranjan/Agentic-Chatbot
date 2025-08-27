// app/page.js
'use client';

import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// Minimal icons (inline SVG)
const AssistantIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon" aria-hidden="true">
    <path d="M15.5 2.25a.75.75 0 0 0-1.06 1.06L15.19 4H8.81l.75-.75a.75.75 0 1 0-1.06-1.06L7.25 3.5H3.75a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16.5a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-3.5L15.5 2.25zM4.75 6.5a1 1 0 0 1 1-1h12.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1v-9.5zm2 2a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5z" />
  </svg>
);
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon" aria-hidden="true">
    <path d="M12 2a5 5 0 0 0-1 9.9V13H8a5 5 0 0 0-5 5v2h18v-2a5 5 0 0 0-5-5h-3v-1.1A5 5 0 0 0 12 2z" />
  </svg>
);
const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon" aria-hidden="true">
    <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405z" />
  </svg>
);
const ChevronIcon = ({ isOpen }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2"
    className={`chevron-icon ${isOpen ? 'open' : ''}`}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

// Copy-enabled code block for markdown
function CodeBlock({ inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeText = String(children).replace(/\n$/, '');

  const onCopy = () => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  if (!inline && match) {
    return (
      <div className="code-block">
        <div className="code-header">
          <span>{match[1]}</span>
          <button type="button" onClick={onCopy} className="copy-btn">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <pre className={className} {...props}><code>{children}</code></pre>
      </div>
    );
  }
  return <code className={className} {...props}>{children}</code>;
}

// Collapsible Reasoning Component
function ReasoningSection({ reasoning }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning) return null;

  return (
    <div className="reasoning-section">
      <button 
        className="reasoning-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls="reasoning-content"
      >
        <ChevronIcon isOpen={isOpen} />
        <span className="reasoning-label">Reasoning</span>
      </button>
      {isOpen && (
        <div id="reasoning-content" className="reasoning-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {reasoning}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  // Messages now include reasoning: { role: 'user'|'assistant', content: string, reasoning?: string }
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Welcome to FinOps Assistant! How can I help with your cloud costs today?' },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);

  // MCP status (providers map from /api/mcp-status)
  const [mcpStatus, setMcpStatus] = useState({ checking: true, connected: false, totalTools: 0, tools: [], error: null });

  const endRef = useRef(null);
  const textRef = useRef(null);

  // Auto-scroll to bottom on new message
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

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
            (arr || []).map((t) => `${p}.${t}`)
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

  const sendMessage = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) return;

    // Push user message
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInputValue('');
    setLoading(true);

    try {
      // Pass prior conversation (excluding any system-only entries)
      const history = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content })); // Strip reasoning from history

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, messages: history }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Request failed');

      // Store both the response and reasoning
      const assistant = {
        role: 'assistant',
        content: typeof data?.result === 'string' ? data.result : 'I processed your request successfully.',
        reasoning: data?.reasoning || null,
      };

      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      setMessages((prev) => [...prev, { 
        role: 'assistant', 
        content: `Error: ${err.message || 'Something went wrong.'}` 
      }]);
    } finally {
      setLoading(false);
      textRef.current?.focus();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    void sendMessage();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const renderAvatar = (role) => (
    <div className={`avatar ${role}`} aria-hidden="true">
      {role === 'assistant' ? <AssistantIcon /> : <UserIcon />}
    </div>
  );

  return (
    <div className="chat-wrapper">
      <header className="chat-header">
        <div className="header-content">
          <div className="brand">
            <AssistantIcon />
            FinOps Assistant
          </div>
          <button 
            type="button" 
            onClick={() => setMessages([{ role: 'assistant', content: 'Welcome to FinOps Assistant! How can I help with your cloud costs today?' }])} 
            className="clear-chat-btn"
          >
            New Chat
          </button>
        </div>

        <div className="sub" aria-live="polite">
          Agent ·
          <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: mcpStatus.checking ? '#f59e0b' : (mcpStatus.connected ? '#22c55e' : '#ef4444'),
                marginRight: 6,
              }}
            />
            <span style={{ fontSize: 12 }}>
              {mcpStatus.checking ? 'MCP: Checking…' : `MCP: ${mcpStatus.connected ? `Connected (${mcpStatus.totalTools})` : 'Disconnected'}`}
            </span>
          </span>
        </div>
      </header>

      <main className="messages" aria-live="polite" aria-busy={loading}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`message-container ${msg.role}`}>
            <div className={`message ${msg.role}`}>
              {renderAvatar(msg.role)}
              <div className={`bubble ${msg.role}`}>
                {msg.role === 'assistant' && msg.reasoning && (
                  <ReasoningSection reasoning={msg.reasoning} />
                )}
                <div className="message-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                      code: CodeBlock,
                      a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="message-container assistant">
            <div className="message assistant">
              {renderAvatar('assistant')}
              <div className="bubble assistant typing">
                <div>
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          ref={textRef}
          className="input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message…"
          rows={1}
          spellCheck={true}
        />
        <button className="send-button" type="submit" disabled={loading || !inputValue.trim()} aria-label="Send message">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}