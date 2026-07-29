import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Calendar, Search, Video, MapPin, User, Clock, ExternalLink,
  CheckCircle2, XCircle, AlertCircle, ChevronRight,
} from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

function formatDateTime(d) {
  if (!d) return { date: '—', time: '' };
  const dt = new Date(d);
  return {
    date: dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    time: dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    full: dt,
  };
}

function isToday(d) {
  if (!d) return false;
  const dt = new Date(d);
  const now = new Date();
  return dt.toDateString() === now.toDateString();
}

function isTomorrow(d) {
  if (!d) return false;
  const dt = new Date(d);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dt.toDateString() === tomorrow.toDateString();
}

const RESULT_CONFIG = {
  passed: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  selected: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2 },
  failed: { bg: 'bg-red-50', text: 'text-red-600', icon: XCircle },
  rejected: { bg: 'bg-red-50', text: 'text-red-600', icon: XCircle },
  pending: { bg: 'bg-amber-50', text: 'text-amber-600', icon: AlertCircle },
  scheduled: { bg: 'bg-[#F0FDFA]', text: 'text-[#0F766E]', icon: Clock },
};

function ResultBadge({ result }) {
  const cfg = RESULT_CONFIG[result?.toLowerCase()] || { bg: 'bg-gray-50', text: 'text-gray-600', icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
      <Icon size={10} />
      {result || 'Scheduled'}
    </span>
  );
}

function InterviewCard({ interview, highlight }) {
  const { date, time } = formatDateTime(interview.scheduled_start);
  const endTime = interview.scheduled_end ? formatDateTime(interview.scheduled_end).time : null;

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.05)] transition hover:shadow-md ${
      highlight ? 'border-[#0F766E]/30 ring-1 ring-[#0F766E]/20' : 'border-[#E8EAED]'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[#1F2023] truncate">{interview.candidate_name}</div>
          <div className="text-sm text-[#6b7280] truncate mt-0.5">{interview.job_title || '—'}</div>
        </div>
        <ResultBadge result={interview.result} />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="flex items-center gap-2 rounded-xl bg-[#F7F8FA] px-3 py-2">
          <Calendar size={14} className="text-[#0F766E] shrink-0" />
          <div>
            <div className="text-[10px] text-[#9ca3af] font-medium">Date</div>
            <div className="text-xs font-semibold text-[#1F2023]">
              {highlight ? (
                <span className="text-[#0F766E]">{isToday(interview.scheduled_start) ? 'Today' : 'Tomorrow'}</span>
              ) : date}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-[#F7F8FA] px-3 py-2">
          <Clock size={14} className="text-[#f59e0b] shrink-0" />
          <div>
            <div className="text-[10px] text-[#9ca3af] font-medium">Time</div>
            <div className="text-xs font-semibold text-[#1F2023]">
              {time}{endTime ? ` – ${endTime}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {interview.round_label && (
          <span className="rounded-full bg-[#F0FDFA] border border-[#CCFBF1] px-2.5 py-0.5 text-[11px] font-medium text-[#0F766E]">
            {interview.round_label}
          </span>
        )}
        {interview.mode && (
          <span className="flex items-center gap-1 rounded-full bg-[#f0fdf4] border border-[#dcfce7] px-2.5 py-0.5 text-[11px] font-medium text-[#15803d]">
            {interview.mode?.toLowerCase() === 'online' || interview.mode?.toLowerCase() === 'video' ? (
              <Video size={10} />
            ) : (
              <MapPin size={10} />
            )}
            {interview.mode}
          </span>
        )}
        {interview.interviewer_names?.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-[#9ca3af]">
            <User size={10} />
            {interview.interviewer_names.slice(0, 2).join(', ')}
            {interview.interviewer_names.length > 2 && ` +${interview.interviewer_names.length - 2}`}
          </span>
        )}
        {interview.meeting_link && (
          <a
            href={interview.meeting_link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 rounded-lg bg-[#0F766E] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#115E59] transition"
          >
            Join <ExternalLink size={10} />
          </a>
        )}
      </div>

      {interview.candidate_email && (
        <div className="mt-2 text-[11px] text-[#9ca3af]">{interview.candidate_email}</div>
      )}
    </div>
  );
}

function Section({ title, interviews, highlight, emptyMsg }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1F2023]">
        {highlight && <span className="h-2 w-2 rounded-full bg-[#0F766E] animate-pulse" />}
        {!highlight && <span className="h-2 w-2 rounded-full bg-[#d1d5db]" />}
        {title} ({interviews.length})
      </h2>
      {interviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#E8EAED] py-8 text-center text-sm text-[#9ca3af]">
          {emptyMsg}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {interviews.map((i) => (
            <InterviewCard key={i.id} interview={i} highlight={highlight} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showUpcoming, setShowUpcoming] = useState(true);
  const pageRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    api(`/interviews`)
      .then((d) => setInterviews(d.interviews || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useGSAP(() => {
    gsap.from('.interviews-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
    gsap.from('.interview-card', { opacity: 0, y: 16, duration: 0.35, stagger: 0.05, ease: 'power2.out', delay: 0.1 });
  }, { scope: pageRef, dependencies: [loading] });

  const filtered = q
    ? interviews.filter(
        (i) =>
          i.candidate_name?.toLowerCase().includes(q.toLowerCase()) ||
          i.job_title?.toLowerCase().includes(q.toLowerCase()) ||
          i.candidate_email?.toLowerCase().includes(q.toLowerCase())
      )
    : interviews;

  const now = new Date();
  const upcoming = filtered.filter((i) => i.scheduled_start && new Date(i.scheduled_start) >= now);
  const past = filtered.filter((i) => !i.scheduled_start || new Date(i.scheduled_start) < now);
  const todayList = upcoming.filter((i) => isToday(i.scheduled_start));
  const tomorrowList = upcoming.filter((i) => isTomorrow(i.scheduled_start));
  const laterList = upcoming.filter((i) => !isToday(i.scheduled_start) && !isTomorrow(i.scheduled_start));

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_250px_at_50%_-80px,rgba(6,182,212,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="interviews-header flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1F2023]">Interviews</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              Schedule · {upcoming.length} upcoming · {past.length} past
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUpcoming(true)}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${showUpcoming ? 'border-[#06b6d4]/30 bg-[#ecfeff] text-[#0891b2]' : 'border-[#E8EAED] bg-white text-[#6b7280]'}`}
            >
              Upcoming ({upcoming.length})
            </button>
            <button
              onClick={() => setShowUpcoming(false)}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${!showUpcoming ? 'border-[#E8EAED] bg-[#F7F8FA] text-[#374151]' : 'border-[#E8EAED] bg-white text-[#6b7280]'}`}
            >
              Past ({past.length})
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search candidate, job title…"
            className="w-full rounded-2xl border border-[#E8EAED] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#06b6d4] focus:ring-2 focus:ring-[#06b6d4]/10"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-[#06b6d4] border-t-transparent animate-spin" />
          </div>
        ) : showUpcoming ? (
          <>
            {todayList.length > 0 && (
              <Section title="Today" interviews={todayList} highlight emptyMsg="No interviews today" />
            )}
            {tomorrowList.length > 0 && (
              <Section title="Tomorrow" interviews={tomorrowList} highlight={false} emptyMsg="No interviews tomorrow" />
            )}
            <Section
              title="Later"
              interviews={laterList}
              highlight={false}
              emptyMsg="No upcoming interviews scheduled"
            />
            {upcoming.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[#9ca3af]">
                <Calendar size={40} strokeWidth={1.25} />
                <p className="text-sm">No upcoming interviews. Sync ATS data to populate.</p>
              </div>
            )}
          </>
        ) : (
          <Section
            title="Past Interviews"
            interviews={past.slice(0, 50)}
            highlight={false}
            emptyMsg="No past interview records."
          />
        )}
      </div>
    </div>
  );
}
