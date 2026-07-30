import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
  UserCheck,
  UserRoundSearch,
  MessageSquare,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { BentoCard, BentoGrid } from '@/components/ui/bento-grid';
import { PromptInputBox } from '@/components/ui/ai-prompt-box';

const MAX_CHARS = 4000;

const SUGGESTED_BENTO = [
  {
    id: 's1',
    name: "Today's daily briefing",
    description: 'Attendance, missing EODs, overdue tasks, and interviews — one morning snapshot.',
    prompt:
      "Give me today's daily briefing with attendance, missing EODs, overdue tasks, and interviews. Write a full, clear Gemini-style answer.",
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
      'Who needs my attention right now — absentees, late vs shift, missing EODs, and overdue work? Explain clearly with names and next steps.',
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
    prompt:
      "Who is present, absent, or late today? Include late minutes vs each person's shift and summarize in a readable report.",
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
    prompt:
      "Give me Jeevan's full status today — attendance, open tasks, EOD, and any blockers. Write it like a complete Gemini briefing.",
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
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
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

function normalizeOutgoing(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';

  // Mode prefixes from PromptInputBox → clearer instructions for the model
  const search = raw.match(/^\[Search:\s*([\s\S]*)\]$/i);
  if (search) {
    return `Search the hub thoroughly and answer fully like Gemini:\n\n${search[1].trim()}\n\nCover every relevant person/number, then suggest a next step.`;
  }
  const think = raw.match(/^\[Think:\s*([\s\S]*)\]$/i);
  if (think) {
    return `Think deeply and write a complete, well-structured answer:\n\n${think[1].trim()}\n\nInclude Quick take, detailed sections, risks, and recommended actions.`;
  }
  const canvas = raw.match(/^\[Canvas:\s*([\s\S]*)\]$/i);
  if (canvas) {
    return `Produce a structured manager report (markdown headings + bullets):\n\n${canvas[1].trim()}\n\nMake it presentation-ready and complete.`;
  }
  return raw.slice(0, MAX_CHARS);
}

function CopyButton({ text }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* ignore */
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#6b7280] transition hover:bg-[#f3f4f6] hover:text-[#111827]"
    >
      {ok ? <Check size={12} /> : <Copy size={12} />}
      {ok ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

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
    const message = normalizeOutgoing(text);
    if (!message || busy) return;
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
          content: `I couldn't complete that request just now (${err.message || 'something went wrong'}).\n\nPlease try again — I can still pull attendance, tasks, EODs, and interviews from the hub.`,
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
    setError('');
  }

  const prompt = (
    <div className="w-full max-w-[760px]">
      {error && <p className="mb-2 text-center text-xs text-red-500">{error}</p>}
      <PromptInputBox
        isLoading={busy}
        placeholder="Ask Hub AI anything about your team…"
        onSend={(message) => send(message)}
      />
      <p className="mt-2 text-center text-[11px] text-[#9ca3af]">
        Hub AI uses live hub data · accuracy first · tools only
      </p>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#f7f8fa]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_480px_at_50%_-120px,rgba(15,118,110,0.12),transparent_70%)]" />

      {!inConversation ? (
        <div className="relative z-10 flex h-full flex-col overflow-y-auto px-6 pb-10 pt-12 md:px-10">
          <div className="mx-auto flex w-full max-w-[960px] flex-col items-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 scale-125 rounded-full bg-brand/20 blur-2xl" />
              <img
                src="/ai-orb.png"
                alt=""
                className="relative h-[96px] w-[96px] rounded-full object-cover shadow-[0_12px_40px_rgba(15,118,110,0.28)]"
              />
            </div>

            <h1 className="text-center text-[34px] font-semibold tracking-tight text-[#1F2023] md:text-[40px]">
              {greetingForNow()}, {firstName(user?.name)}
            </h1>
            <p className="mt-2 max-w-[640px] text-center text-[15px] leading-relaxed text-[#6b7280]">
              Your Gemini-style co-pilot for attendance, tasks, EODs, and hiring — ask anything and get a
              complete, readable answer from the hub.
            </p>

            <div className="mt-8 w-full max-w-[760px]">{prompt}</div>

            <div className="mt-12 w-full">
              <h2 className="mb-4 text-[15px] font-medium text-[#6b7280]">Suggested for you</h2>
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
          <header className="flex items-center justify-between border-b border-[#e8eaed]/80 bg-white/75 px-5 py-3 backdrop-blur">
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
            >
              <ArrowLeft size={16} /> New chat
            </button>
            <div className="flex items-center gap-2 text-sm font-medium text-[#202124]">
              <img src="/ai-orb.png" alt="" className="h-7 w-7 rounded-full" />
              Hub AI
            </div>
            <div className="w-[96px]" />
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
            <div className="mx-auto max-w-[800px] space-y-8">
              {messages.map((m) => (
                <div key={m.id} className="group">
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-[22px] rounded-br-md bg-[#E6F4F1] px-4 py-3 text-[15px] leading-relaxed text-[#0F766E] shadow-sm">
                        <div className="whitespace-pre-wrap text-[#202124]">{m.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <img
                        src="/ai-orb.png"
                        alt=""
                        className="mt-1 h-8 w-8 shrink-0 rounded-full shadow-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-[#202124]">Hub AI</span>
                          <CopyButton text={m.content} />
                        </div>
                        <div className="gemini-reply text-[15px] leading-[1.7] text-[#3c4043]">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                        {m.toolsUsed?.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {m.toolsUsed.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[10px] font-medium text-[#5f6368]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex gap-3">
                  <img src="/ai-orb.png" alt="" className="mt-1 h-8 w-8 rounded-full" />
                  <div>
                    <div className="mb-1 text-[13px] font-semibold text-[#202124]">Hub AI</div>
                    <div className="flex items-center gap-1.5 text-sm text-[#5f6368]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0F766E]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0F766E] [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0F766E] [animation-delay:300ms]" />
                      <span className="ml-1">Thinking…</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-[#e8eaed]/80 bg-gradient-to-t from-white via-white/95 to-white/70 px-4 py-4 backdrop-blur md:px-8">
            <div className="mx-auto flex justify-center">{prompt}</div>
          </div>
        </div>
      )}
    </div>
  );
}
