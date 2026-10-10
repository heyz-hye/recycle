"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageCircle, X, Send, Sprout } from "lucide-react";
import { api, ApiError, ChatReply } from "@/lib/api";

type Message = { role: "user" | "assistant"; text: string };

const CHIPS = [
  "How do I prepare cardboard?",
  "How much LOOP for 10 bottles?",
  "Where are my tokens?",
  "Community impact this week",
];

// react-markdown never renders raw HTML from the model, so no sanitizer is needed.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}

export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);
  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const result = await api<ChatReply>("/chat", { message });
      setMessages((m) => [...m, { role: "assistant", text: result.reply }]);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "The assistant is temporarily unavailable. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }
  return (
    <>
      <button
        className="assistant-fab"
        aria-label={
          open ? "Close LoopMint Assistant" : "Open LoopMint Assistant"
        }
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
      {open && (
        <div
          className="assistant-panel"
          role="dialog"
          aria-label="LoopMint Assistant"
        >
          <div className="assistant-heading">
            <div>
              <strong>LoopMint Assistant</strong>
              <span>Recycling questions, answered</span>
            </div>
            <button
              className="icon-button"
              aria-label="Close LoopMint Assistant"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="assistant-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="assistant-empty">
                <Sprout size={22} />
                <p>
                  Ask about preparing materials, estimated rewards, your tokens,
                  or community impact.
                </p>
                <div className="assistant-chips">
                  {CHIPS.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => void send(chip)}
                      disabled={busy}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`assistant-message ${m.role}`}>
                {m.role === "assistant" ? (
                  <AssistantMarkdown text={m.text} />
                ) : (
                  m.text
                )}
              </div>
            ))}
            {busy && (
              <div className="assistant-message assistant pending">
                Thinking…
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="error-text assistant-error">
              {error}
            </p>
          )}
          <form className="assistant-input" onSubmit={submit}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask LoopMint Assistant…"
              maxLength={1000}
              disabled={busy}
              aria-label="Message LoopMint Assistant"
            />
            <button
              className="icon-button"
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
