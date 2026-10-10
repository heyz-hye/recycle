"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Leaf, MessageCircle, RotateCcw, X } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };
const suggestions = ["Can I recycle pizza boxes?", "What do plastic numbers mean?", "How do I dispose of batteries?"];

// React escapes all text; only a tiny, safe subset of formatting is supported.
function Reply({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong> : part)}</>;
}

export default function RecyclingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<Message[] | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const active = useRef<AbortController | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, busy, error, open]);
  useEffect(() => () => active.current?.abort(), []);

  function close() { setOpen(false); launcher.current?.focus(); }
  function reset() {
    active.current?.abort();
    active.current = null;
    sending.current = false;
    setBusy(false); setMessages([]); setDraft(""); setError(""); setFailed(null);
    input.current?.focus();
  }

  async function send(text: string, retry?: Message[]) {
    if (sending.current || !text.trim()) return;
    // Send at most nine complete prior exchanges plus the current question.
    const history = retry || [...messages.slice(-18), { role: "user" as const, content: text.trim() }];
    const controller = new AbortController();
    active.current = controller;
    sending.current = true;
    setMessages(history); setDraft(""); setBusy(true); setError(""); setFailed(null);
    const timeout = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Please shorten your message or start a new chat.");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("I couldn't read that response. Please try again.");
      if (active.current === controller) setMessages([...history, { role: "assistant", content: data.reply }]);
    } catch (e) {
      if (active.current === controller) {
        setError(controller.signal.aborted ? "That took a little too long. Please try again." : e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't connect. Check your connection and try again.");
        setFailed(history);
      }
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) {
        sending.current = false; setBusy(false); active.current = null;
        requestAnimationFrame(() => input.current?.focus());
      }
    }
  }

  function submit(e: FormEvent) { e.preventDefault(); void send(draft); }

  return <div className="recycling-chat">
    {open && <section id="recycling-chat-panel" className="recycling-chat-panel" aria-label="Recycling support chat" onKeyDown={e => { if (e.key === "Escape") close(); }}>
      <header className="recycling-chat-header">
        <span className="recycling-chat-avatar"><Leaf size={23} /></span>
        <div><h2>Ask Loop</h2><p>Your AI recycling guide</p></div>
        <button className="recycling-chat-icon" onClick={reset} aria-label="Start a new chat" title="Start a new chat"><RotateCcw size={17} /></button>
        <button className="recycling-chat-icon" onClick={close} aria-label="Close recycling chat"><X size={21} /></button>
      </header>
      <div className="recycling-chat-scroll" ref={scroll}>
        <div className="recycling-chat-welcome">
          <span className="recycling-chat-eyebrow">SMALL QUESTIONS. BETTER HABITS.</span>
          <h3>A little help,<br />a greener everyday.</h3>
          <p>Unsure which bin it goes in? Let’s figure it out. Ask me about recycling, tricky materials, or getting started with LoopMint.</p>
        </div>
        {!messages.length && <div className="recycling-chat-suggestions">{suggestions.map(question => <button key={question} onClick={() => void send(question)}>{question}<span aria-hidden="true">↗</span></button>)}</div>}
        <div className="recycling-chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
          {messages.map((message, i) => <div key={i} className={`recycling-chat-message ${message.role}`}>
            <span className="recycling-chat-speaker">{message.role === "assistant" ? "Loop" : "You"}</span>
            <p><Reply text={message.content} /></p>
          </div>)}
          {busy && <div className="recycling-chat-thinking" role="status"><span /><span /><span /><small>Loop is thinking</small></div>}
        </div>
        {error && <div className="recycling-chat-error" role="alert"><p>{error}</p><button onClick={() => failed && void send(failed[failed.length - 1].content, failed)}>Try again</button><button onClick={reset}>New chat</button></div>}
      </div>
      <form className="recycling-chat-form" onSubmit={submit}>
        <label className="recycling-chat-sr" htmlFor="recycling-chat-question">Your recycling question</label>
        <div className="recycling-chat-input">
          <textarea ref={input} id="recycling-chat-question" value={draft} maxLength={2000} rows={2} placeholder="Ask a recycling question…" disabled={busy || !!failed}
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && !failed) void send(draft); } }} />
          <button type="submit" disabled={busy || !!failed || !draft.trim()} aria-label="Send message"><ArrowUp size={20} /></button>
        </div>
        <p>Powered by Gemini · Local recycling rules may vary.</p>
        <p className="recycling-chat-privacy">Messages are sent to Google. Avoid sharing personal details.</p>
      </form>
    </section>}
    <button ref={launcher} className={`recycling-chat-launcher ${open ? "is-open" : ""}`} onClick={() => open ? close() : setOpen(true)} aria-expanded={open} aria-controls="recycling-chat-panel" aria-label={open ? "Close recycling chat" : "Open recycling chat"}>
      {open ? <X size={21} /> : <MessageCircle size={21} />}<span>{open ? "Close chat" : "Ask Loop"}</span>{!open && <span className="recycling-chat-dot" />}
    </button>
  </div>;
}
