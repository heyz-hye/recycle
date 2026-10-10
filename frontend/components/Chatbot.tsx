"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };
type GeminiMessage = { role: "user" | "model"; text: string };

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hi! I can help with LoopMint and recycling basics. I cannot see your wallet or live recycling-center information.",
};
const suggestions = [
  "How does a recycling drop-off work?",
  "Do demo tokens have real value?",
];

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, busy, open]);

  async function sendText(value: string) {
    const text = value.trim();
    if (!text || busy || text.length > 1200) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const history = messages
      .filter((message) => message.id !== "welcome")
      .slice(-7);
    if (history[0]?.role === "assistant") history.shift();
    const apiMessages: GeminiMessage[] = [
      ...history.map((message): GeminiMessage => ({
        role: message.role === "assistant" ? "model" : "user",
        text: message.text,
      })),
      { role: "user", text },
    ];

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const result = await api<{ reply: string }>("/chat", {
        messages: apiMessages,
      });
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", text: result.reply },
      ]);
    } catch (cause) {
      setMessages((current) =>
        current.filter((message) => message.id !== userMessage.id),
      );
      setDraft(text);
      setError(
        cause instanceof Error
          ? cause.message
          : "The assistant is unavailable. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendText(draft);
  }

  return (
    <div className="assistant-widget">
      {open && (
        <section
          aria-label="LoopMint AI assistant"
          aria-modal="false"
          className="assistant-panel"
          id="loopmint-assistant"
          role="dialog"
        >
          <header className="assistant-header">
            <div className="assistant-avatar">
              <Bot size={19} />
            </div>
            <div className="assistant-heading">
              <strong>LoopMint assistant</strong>
              <span>
                <span className="assistant-live-dot" /> Powered by Gemini
              </span>
            </div>
            <button
              aria-label="Close assistant"
              className="assistant-icon-button"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={19} />
            </button>
          </header>

          <div aria-live="polite" className="assistant-messages" role="log">
            {messages.map((message) => (
              <div
                className={`assistant-message ${message.role}`}
                key={message.id}
              >
                {message.role === "assistant" && (
                  <span aria-hidden="true" className="assistant-message-icon">
                    <Sparkles size={13} />
                  </span>
                )}
                <p>{message.text}</p>
              </div>
            ))}
            {messages.length === 1 && !busy && (
              <div className="assistant-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => void sendText(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <div
                aria-label="Assistant is responding"
                className="assistant-typing"
              >
                <Loader2
                  aria-hidden="true"
                  className="assistant-spinner"
                  size={15}
                />
                Thinking...
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}
          <form className="assistant-form" onSubmit={submit}>
            <textarea
              aria-label="Message the LoopMint assistant"
              maxLength={1200}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendText(draft);
                }
              }}
              placeholder="Ask a question..."
              ref={textareaRef}
              rows={1}
              value={draft}
            />
            <button
              aria-label="Send message"
              className="assistant-send"
              disabled={busy || !draft.trim()}
              type="submit"
            >
              {busy ? (
                <Loader2 className="assistant-spinner" size={17} />
              ) : (
                <Send size={17} />
              )}
            </button>
          </form>
          <p className="assistant-privacy">
            Messages go to Google Gemini. Do not share passwords or wallet recovery phrases.
          </p>
        </section>
      )}

      <button
        aria-controls={open ? "loopmint-assistant" : undefined}
        aria-expanded={open}
        aria-label={open ? "Close LoopMint assistant" : "Open LoopMint assistant"}
        className="assistant-launcher"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && <span>Ask LoopMint</span>}
      </button>
    </div>
  );
}
