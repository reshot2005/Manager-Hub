import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles,
  Globe,
  Send,
  ChevronDown,
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
  UserCheck,
  UserRoundSearch,
  MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BentoCard, BentoGrid } from '@/components/ui/bento-grid';

const MAX_CHARS = 1000;

const SUGGESTED_BENTO = [
  {
    id: 's1',
    name: "Today's daily briefing",
    description: 'Attendance, missing EODs, overdue tasks, and interviews — one morning snapshot.',
    prompt:
      "Give me today's daily briefing with attendance, missing EODs, overdue tasks, and interviews",
    Icon: ClipboardList,
    cta: 'Ask now',
    className: 'lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3',
    background: (
      <img
        src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=60"
        alt=""
        className="absolute -right-16 -top-16 h-56 w-56 rounded-full object-cover opacity-25"
      />
    ),
  },
  {
    id: 's2',
    name: 'Who needs attention?',
    description: 'Absentees, late vs shift, missing EODs, and overdue work that needs you.',
    prompt:
      'Who needs my attention right now — absentees, late vs shift, missing EODs, and overdue work?',
    Icon: AlertTriangle,
    cta: 'Ask now',
    className: 'lg:col-start-2 lg:col-end-4 lg:row-start-1 lg:row-end-2',
    background: (
      <img
        src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=60"
        alt=""
        className="absolute -right-10 -top-10 h-48 w-72 object-cover opacity-20"
      />
    ),
  },
  {
    id: 's3',
    name: 'Present / absent / late',
    description: "Live headcount with late minutes vs each person's shift.",
    prompt: "Who is present, absent, or late today? Include late minutes vs each person's shift.",
    Icon: UserCheck,
    cta: 'Ask now',
    className: 'lg:col-start-2 lg:col-end-3 lg:row-start-2 lg:row-end-3',
    background: (
      <img
        src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=60"
        alt=""
        className="absolute -right-12 -top-8 h-44 w-56 object-cover opacity-20"
      />
    ),
  },
  {
    id: 's4',
    name: 'Full employee status',
    description: 'Attendance, open tasks, EOD, and blockers for one person.',
    prompt: "Give me Jeevan's full status today — attendance, open tasks, EOD, and any blockers",
    Icon: UserRoundSearch,
    cta: 'Ask now',
    className: 'lg:col-start-3 lg:col-end-4 lg:row-start-2 lg:row-end-3',
    background: (
      <img
        src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=60"
        alt=""
        className="absolute -right-10 -top-10 h-48 w-48 rounded-2xl object-cover opacity-20"
      />
    ),
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

  const recentBento = useMemo(() => {
    const userMsgs = messages.filter((m) => m.role === 'user').slice(-6).reverse();
    if (!userMsgs.length) return SUGGESTED_BENTO;

    const layouts = [
      'lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3',
      'lg:col-start-2 lg:col-end-4 lg:row-start-1 lg:row-end-2',
      'lg:col-start-2 lg:col-end-3 lg:row-start-2 lg:row-end-3',
      'lg:col-start-3 lg:col-end-4 lg:row-start-2 lg:row-end-3',
    ];
    const icons = [MessageSquare, ClipboardList, UserCheck, AlertTriangle];
    const images = [
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=60',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=60',
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=60',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=60',
    ];

    return userMsgs.slice(0, 4).map((m, i) => ({
      id: m.id || `r-${i}`,
      name: m.content.length > 48 ? `${m.content.slice(0, 48)}…` : m.content,
      description: relativeAgo(m.created_at) || 'Recent',
      prompt: m.content,
      Icon: icons[i % icons.length],
      cta: 'Ask again',
      className: layouts[i] || 'lg:col-span-1',
      background: (
        <img
          src={images[i % images.length]}
          alt=""
          className="absolute -right-12 -top-10 h-48 w-56 object-cover opacity-20"
        />
      ),
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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_-80px,rgba(167,139,250,0.22),transparent_70%)]" />

      {!inConversation ? (
        <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 pb-10 pt-12 md:px-10">
          <div className="mx-auto flex w-full max-w-[960px] flex-col items-center">
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
            <p className="mt-2 max-w-[720px] text-center text-[15px] text-mute">
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
              className="mt-8 w-full max-w-[720px]"
            />

            <div className="mt-10 w-full">
              <h2 className="mb-4 text-[17px] font-semibold text-ink">Your recents chats</h2>
              <BentoGrid className="lg:grid-rows-2">
                {recentBento.map((card) => (
                  <BentoCard
                    key={card.id}
                    name={card.name}
                    description={card.description}
                    Icon={card.Icon}
                    background={card.background}
                    className={card.className}
                    cta={card.cta}
                    onClick={() => send(card.prompt)}
                  />
                ))}
              </BentoGrid>
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

        <div className="mt-2 flex items-center justify-end gap-3 border-t border-edge/70 pt-3">
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
  );
}
