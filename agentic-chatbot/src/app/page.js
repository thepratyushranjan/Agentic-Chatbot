'use client'

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

// --- NEW: SVG Icons for a cleaner look ---
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon">
    <path d="M12 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9 11a1 1 0 0 1-2 0v-1a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v1a1 1 0 0 1-2 0v-1a7 7 0 0 1 7-7h8a7 7 0 0 1 7 7v1z" />
  </svg>
);

const AssistantIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon">
    <path d="M15.5 2.25a.75.75 0 0 0-1.06 1.06L15.19 4H8.81l.75-.75a.75.75 0 1 0-1.06-1.06L7.25 3.5H3.75a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16.5a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-3.5L15.5 2.25zM4.75 6.5a1 1 0 0 1 1-1h12.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1v-9.5zm2 2a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="icon">
    <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405z" />
  </svg>
);

// --- NEW: Copy to Clipboard component for code blocks ---
const CodeBlock = ({ node, inline, className, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeText = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
    });
  };

  return !inline && match ? (
    <div className="code-block">
      <div className="code-header">
        <span>{match[1]}</span>
        <button onClick={handleCopy} className="copy-btn">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre {...props} className={className}>
        <code>{children}</code>
      </pre>
    </div>
  ) : (
    <code {...props} className={className}>
      {children}
    </code>
  );
};

const initialMessages = [
  { role: 'assistant', content: 'Hi! I\'m your AI assistant. How can I assist you today?' },
];

export default function Home() {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState(initialMessages);
  const [loading, setLoading] = useState(false);
  const [mcpStatus, setMcpStatus] = useState({ connected: false, loading: true, tools: [], error: null });

  const endOfMessagesRef = useRef(null);
  const textAreaRef = useRef(null);
  
  // --- MODIFIED: Auto-scroll effect ---
  useEffect(() => {   
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // --- NEW: Poll MCP status ---
  useEffect(() => {
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/mcp-status');
        const data = await res.json();
        if (cancelled) return;
        setMcpStatus({
          connected: !!data.connected,
          loading: false,
          tools: Array.isArray(data.tools) ? data.tools : [],
          error: data.error || null,
        });
      } catch (err) {
        if (cancelled) return;
        setMcpStatus({ connected: false, loading: false, tools: [], error: 'Unable to reach MCP status' });
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // --- NEW: Auto-growing textarea effect ---
  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'; // Reset height
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
    }
  }, [inputValue]);

  // --- REMOVED: Truncation preview logic ---

  const sendMessage = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) return;

    const newUserMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, newUserMessage]);
    setInputValue('');
    setLoading(true);

    try {
      // Send conversation history along with the new query
      const conversationHistory = messages.filter(msg => msg.role !== 'system');
      
      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: trimmed,
          messages: conversationHistory 
        }),
      });
      const data = await res.json();

      if (!data) {
        throw new Error('Request failed');
      }

      // Create assistant message with full content (no truncation)
      const assistantContent = data.result || 'No response';

      // If there were tool calls, add some context about what was done
      if (data.toolCalls && data.toolCalls.length > 0) {
        const toolInfo = data.toolCalls.map(call => call.toolName).join(', ');
        console.log('Tools used:', toolInfo);
      }

      const assistantMessage = { 
        role: 'assistant', 
        content: assistantContent,
        shortContent: assistantContent,
        fullContent: assistantContent,
        truncated: false,
        expanded: true,
        ellipsis: false,
        toolCalls: data.toolCalls || [],
        toolResults: data.toolResults || []
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      textAreaRef.current?.focus();
    }
  };

  const handleClearChat = () => {
    setMessages(initialMessages);
  }

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

  const toggleExpand = (index) => {
    setMessages((prev) => prev.map((m, i) => {
      if (i !== index) return m;
      const expanded = !m.expanded;
      return {
        ...m,
        expanded,
        content: expanded ? (m.fullContent ?? m.content) : (m.shortContent ?? m.content)
      };
    }));
  };

  const renderAvatar = (role) => (
    <div className={`avatar ${role}`}>
      {role === 'assistant' ? <AssistantIcon /> : <UserIcon />}
    </div>
  );

  return (
    <div className="chat-wrapper">
      <header className="chat-header">
        <div className="header-content">
          <div className="brand">
            <AssistantIcon />
            AI Assistant
          </div>
          <button onClick={handleClearChat} className="clear-chat-btn">
            New Chat
          </button>
        </div>
        <div className="sub">
          Cloudtuner ·
          <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8 }} title={mcpStatus.error ? `Error: ${mcpStatus.error}` : (mcpStatus.tools.length ? `Tools: ${mcpStatus.tools.join(', ')}` : 'No tools available')}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: mcpStatus.loading ? '#f59e0b' : (mcpStatus.connected ? '#22c55e' : '#ef4444'),
                marginRight: 6,
              }}
            />
            <span style={{ fontSize: 12 }}>
              {mcpStatus.loading ? 'MCP: Checking…' : `MCP: ${mcpStatus.connected ? 'Connected' : 'Disconnected'}`}
            </span>
          </span>
        </div>
      </header>

      <main className="messages" aria-live="polite" aria-busy={loading}>
        {messages.map((msg, idx) => (
          // --- MODIFIED: Added a container for alignment ---
          <div key={idx} className={`message-container ${msg.role}`}>
            <div className={`message ${msg.role}`}>
              {renderAvatar(msg.role)}
              <div className={`bubble ${msg.role}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                    // --- MODIFIED: Use our custom CodeBlock component ---
                    code: CodeBlock,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>

                {msg.role === 'assistant' && msg.truncated && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="clear-chat-btn"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => toggleExpand(idx)}
                    >
                      {msg.expanded ? 'Show less' : 'Show more'}
                    </button>
                  </div>
                )}
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
                {mcpStatus.connected && mcpStatus.tools.length > 0 && (
                  <div className="tool-indicator">
                    <span>🔧 MongoDB tools available</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={endOfMessagesRef} />
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          ref={textAreaRef}
          className="input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          rows={1}
          spellCheck={true}
        />
        <button 
          className="send-button" 
          type="submit" 
          disabled={loading || !inputValue.trim()}
          aria-label="Send message"
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}