"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessageCircle, RotateCcw, X, Send, Sprout } from "lucide-react";
import { api, ApiError, ChatReply } from "@/lib/api";

type Message = { role: "user" | "assistant"; text: string };

// Mirror the API's limits: nine earlier exchanges, 4,000 characters per turn, 16,000 total.
const HISTORY_TURNS = 18;
const TURN_CHARS = 4000;
const TOTAL_CHARS = 16000;

function recentHistory(messages: Message[], message: string): Message[] {
  let history = messages
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, TURN_CHARS) }));
  const size = () => history.reduce((n, m) => n + m.text.length, message.length);
  // Drop whole exchanges so the history still starts with a user turn.
  while (history.length && size() > TOTAL_CHARS) history = history.slice(2);
  return history;
}

const CHIPS = [
  "Where are my tokens?",
  "Show my last withdrawal on Solana",
  "What's 1 LOOP worth?",
  "Why is my reward pending?",
  "Can I recycle pizza boxes?",
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
  // The last user message, still shown, that got no reply; Retry resends it.
  const [failed, setFailed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Bumped by New chat so a reply to the abandoned conversation is ignored.
  const conversation = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, error, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input, open]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    // A new message replaces one that never got a reply, so roles keep alternating.
    const settled = failed === null ? messages : messages.slice(0, -1);
    const history = recentHistory(settled, message);
    const current = conversation.current;
    setMessages([...settled, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError("");
    setFailed(null);
    try {
      const result = await api<ChatReply>("/chat", { message, history });
      if (conversation.current !== current) return;
      setMessages((m) => [...m, { role: "assistant", text: result.reply }]);
    } catch (e) {
      if (conversation.current !== current) return;
      setFailed(message);
      setError(
        !(e instanceof ApiError)
          ? "Couldn't reach the assistant. Check your connection and try again."
          : e.status === 422
            ? // Validation text is written for developers, not people chatting.
              "Something went wrong sending that message. Please try again or start a new chat."
            : e.message,
      );
    } finally {
      if (conversation.current === current) {
        setBusy(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }
  function retry() {
    if (failed !== null) void send(failed);
  }
  function reset() {
    conversation.current += 1;
    setMessages([]);
    setInput("");
    setBusy(false);
    setError("");
    setFailed(null);
    inputRef.current?.focus();
  }
  function close() {
    setOpen(false);
    launcherRef.current?.focus();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }
  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while an IME is composing (e.g. Japanese, Chinese) confirms the text instead.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (e.nativeEvent.keyCode === 229) return;
    e.preventDefault();
    void send(input);
  }
  return (
    <>
      <button
        ref={launcherRef}
        className="assistant-fab"
        aria-label={
          open ? "Close LoopMint Assistant" : "Open LoopMint Assistant"
        }
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
      </button>
      {open && (
        <div
          id="assistant-panel"
          className="assistant-panel"
          role="dialog"
          aria-label="LoopMint Assistant"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="assistant-heading">
            <div>
              <strong>LoopMint Assistant</strong>
              <span>Recycling questions, answered</span>
            </div>
            <div className="assistant-heading-actions">
              <button
                className="icon-button"
                aria-label="Start a new chat"
                title="New chat"
                onClick={reset}
                disabled={!messages.length && !input}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Close LoopMint Assistant"
                onClick={close}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="assistant-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="assistant-empty">
                <Sprout size={22} />
                <p>
                  Ask how to recycle tricky items, or about preparing materials,
                  estimated rewards, your tokens, or community impact.
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
            <div
              className="assistant-log"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Conversation"
            >
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
                <div className="assistant-message assistant pending" role="status">
                  Thinking…
                </div>
              )}
            </div>
            {error && (
              <div className="assistant-error" role="alert">
                <p>{error}</p>
                <div>
                  <button className="button secondary small-button" onClick={retry}>
                    Retry
                  </button>
                  <button className="button secondary small-button" onClick={reset}>
                    New chat
                  </button>
                </div>
              </div>
            )}
          </div>
          <form className="assistant-input" onSubmit={submit}>
            <div className="assistant-input-row">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Ask LoopMint Assistant…"
                maxLength={1000}
                rows={1}
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
            </div>
            <p className="assistant-privacy">
              Messages are sent to Google. Avoid sharing personal details.
            </p>
          </form>
        </div>
      )}
    </>
  );
}
