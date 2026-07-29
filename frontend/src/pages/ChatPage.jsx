import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles,
  Globe,
  Paperclip,
  Image as ImageIcon,
  Send,
  MessageSquare,
  ChevronDown,
  ArrowLeft,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const MAX_CHARS = 1000;

const DEFAULT_RECENTS = [
  {
    id: 's1',
    title: "Today's daily briefing",
    prompt: "Give me today's daily briefing with attendance, missing EODs, overdue tasks, and interviews",
    ago: 'Suggested',
  },
  {
    id: 's2',
    title: 'Who needs attention?',
    prompt: 'Who needs my attention right now — absentees, late vs shift, missing EODs, and overdue work?',
    ago: 'Suggested',
  },
  {
    id: 's3',
    title: 'Present / absent / late',
    prompt: 'Who is present, absent, or late today? Include late minutes vs each person\'s shift.',
    ago: 'Suggested',
  },
  {
    id: 's4',
    title: 'Full employee status',
    prompt: "Give me Jeevan's full status today — attendance, open tasks, EOD, and any blockers",
    ago: 'Suggested',
  },
];

function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function relativeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.max(1, Math.round(ms / 3600000));
  if (hours < 24) return `${hours} Hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} Day${days === 1 ? '' : 's'}`;
}

function firstName(name) {
  return (name || 'Manager').split(' ')[0];
}

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('All Data');
  const [scopeOpen, setScopeOpen] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const inConversation = messages.length > 0;

  useEffect(() => {
    api('/chat/history')
      .then((data) => {
        setMessages(
          (data.history || []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const recentCards = useMemo(() => {
    const userMsgs = messages.filter((m) => m.role === 'user').slice(-6).reverse();
    if (!userMsgs.length) return DEFAULT_RECENTS;
    return userMsgs.slice(0, 3).map((m, i) => ({
      id: m.id || `r-${i}`,
      title: m.content.length > 56 ? `${m.content.slice(0, 56)}…` : m.content,
      prompt: m.content,
      ago: relativeAgo(m.created_at) || 'Recent',
    }));
  }, [messages]);

  async function send(text) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    if (message.length > MAX_CHARS) return;
    setInput('');
    setError('');
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: message, created_at: new Date().toISOString() },
    ]);
    setBusy(true);
    try {
      const data = await api('/chat', { method: 'POST', body: { message } });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.reply,
          toolsUsed: data.toolsUsed,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err.message || 'Chat failed');
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: `Sorry — ${err.message || 'something went wrong'}.`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function startNewChat() {
    try {
      await api('/chat/history', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    setMessages([]);
    setInput('');
    setError('');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* soft purple wash like the mock */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_-80px,rgba(167,139,250,0.22),transparent_70%)]" />

      {!inConversation ? (
        <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 pb-10 pt-12 md:px-10">
          <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 scale-125 rounded-full bg-brand/20 blur-2xl" />
              <img
                src="/ai-orb.png"
                alt=""
                className="relative h-[108px] w-[108px] rounded-full object-cover shadow-[0_12px_40px_rgba(108,77,255,0.35)]"
              />
            </div>

            <h1 className="text-center text-[32px] font-bold tracking-tight text-brand-ink md:text-[36px]">
              {greetingForNow()}, {firstName(user?.name)}
            </h1>
            <p className="mt-2 text-center text-[15px] text-mute">
              Real-time co-pilot for attendance, tasks, EODs, and hiring — ask anything about your team.
            </p>

            <PromptCard
              input={input}
              setInput={setInput}
              busy={busy}
              error={error}
              scope={scope}
              setScope={setScope}
              scopeOpen={scopeOpen}
              setScopeOpen={setScopeOpen}
              onSend={() => send()}
              onKeyDown={onKeyDown}
              textareaRef={textareaRef}
              className="mt-8 w-full"
            />

            <div className="mt-10 w-full">
              <h2 className="mb-4 text-[17px] font-semibold text-ink">Your recents chats</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recentCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => send(card.prompt)}
                    className="recent-card"
                  >
                    <MessageSquare size={18} className="mb-3 text-mute" strokeWidth={1.75} />
                    <p className="min-h-[44px] text-[14px] font-semibold leading-snug text-ink">
                      {card.title}
                    </p>
                    <p className="mt-4 text-[12px] text-mute">{card.ago}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-edge/80 bg-white/70 px-5 py-3.5 backdrop-blur">
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-medium text-ink-soft hover:bg-brand-mist hover:text-brand"
            >
              <ArrowLeft size={16} /> New chat
            </button>
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
              <img src="/ai-orb.png" alt="" className="h-7 w-7 rounded-full" />
              Manager AI
            </div>
            <div className="w-[88px]" />
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-6 md:px-10">
            <div className="mx-auto max-w-[720px] space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role !== 'user' && (
                    <img
                      src="/ai-orb.png"
                      alt=""
                      className="mr-3 mt-1 h-8 w-8 shrink-0 rounded-full"
                    />
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
                      m.role === 'user'
                        ? 'whitespace-pre-wrap rounded-br-md bg-brand text-white shadow-[0_8px_20px_rgba(108,77,255,0.25)]'
                        : 'rounded-bl-md border border-edge bg-white text-ink shadow-card'
                    }`}
                  >
                    {m.role === 'user' ? (
                      m.content
                    ) : (
                      <div className="md-reply">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex items-start">
                  <img src="/ai-orb.png" alt="" className="mr-3 h-8 w-8 rounded-full" />
                  <div className="rounded-2xl rounded-bl-md border border-edge bg-white px-4 py-3 text-sm text-mute shadow-card">
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-edge/80 bg-white/80 px-5 py-4 backdrop-blur md:px-10">
            <PromptCard
              input={input}
              setInput={setInput}
              busy={busy}
              error={error}
              scope={scope}
              setScope={setScope}
              scopeOpen={scopeOpen}
              setScopeOpen={setScopeOpen}
              onSend={() => send()}
              onKeyDown={onKeyDown}
              textareaRef={textareaRef}
              className="mx-auto max-w-[720px]"
              compact
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PromptCard({
  input,
  setInput,
  busy,
  error,
  scope,
  setScope,
  scopeOpen,
  setScopeOpen,
  onSend,
  onKeyDown,
  textareaRef,
  className = '',
  compact = false,
}) {
  const scopes = ['All Data', 'Employees', 'Attendance', 'Candidates', 'Interviews'];

  return (
    <div className={className}>
      {error && <p className="mb-2 text-center text-xs text-red-500">{error}</p>}
      <div className={`prompt-card ${compact ? 'p-3' : 'p-4 md:p-5'}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-mute">
            <Sparkles size={16} className="text-brand" />
            Ask whatever you want
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setScopeOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-canvas px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:border-brand/30"
            >
              <Globe size={13} className="text-brand" />
              {scope}
              <ChevronDown size={13} />
            </button>
            {scopeOpen && (
              <div className="absolute right-0 z-30 mt-1.5 min-w-[140px] overflow-hidden rounded-xl border border-edge bg-white py-1 shadow-card">
                {scopes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-brand-mist ${
                      s === scope ? 'font-semibold text-brand' : 'text-ink-soft'
                    }`}
                    onClick={() => {
                      setScope(s);
                      setScopeOpen(false);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKeyDown}
          rows={compact ? 2 : 4}
          disabled={busy}
          placeholder=""
          className="w-full resize-none border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-mute disabled:opacity-60"
        />

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-edge/70 pt-3">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-mute hover:bg-brand-mist hover:text-brand"
            >
              <Paperclip size={14} />
              Add Attachment
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-mute hover:bg-brand-mist hover:text-brand"
            >
              <ImageIcon size={14} />
              Use Image
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[12px] tabular-nums text-mute">
              {input.length}/{MAX_CHARS}
            </span>
            <button
              type="button"
              onClick={onSend}
              disabled={busy || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white shadow-[0_8px_18px_rgba(108,77,255,0.35)] transition hover:bg-brand-deep disabled:opacity-40"
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
