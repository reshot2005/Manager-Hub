import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Search, UserRoundSearch, X, ChevronRight, Calendar, Mail,
  Phone, Building2, Briefcase, Star, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

function formatDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return null;
  const dt = new Date(d);
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STAGE_ORDER = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const STAGE_CONFIG = {
  Applied: { color: '#6b7280', bg: '#f3f4f6' },
  Screening: { color: '#0F766E', bg: '#F0FDFA' },
  Interview: { color: '#0891b2', bg: '#ecfeff' },
  Offer: { color: '#f59e0b', bg: '#fef3c7' },
  Hired: { color: '#10b981', bg: '#dcfce7' },
  Rejected: { color: '#ef4444', bg: '#fee2e2' },
};

function getStageCfg(stage) {
  const key = Object.keys(STAGE_CONFIG).find((k) =>
    stage?.toLowerCase().includes(k.toLowerCase())
  );
  return STAGE_CONFIG[key] || { color: '#6b7280', bg: '#f3f4f6' };
}

function StageBadge({ stage }) {
  const cfg = getStageCfg(stage);
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {stage || 'Applied'}
    </span>
  );
}

function PipelineFunnel({ candidates }) {
  const stages = STAGE_ORDER.map((s) => ({
    stage: s,
    count: candidates.filter((c) =>
      c.stage_name?.toLowerCase().includes(s.toLowerCase()) ||
      c.application_status?.toLowerCase().includes(s.toLowerCase())
    ).length,
    cfg: STAGE_CONFIG[s],
  }));
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="flex items-end gap-2 h-20">
      {stages.map((s) => {
        const h = Math.max(8, Math.round((s.count / maxCount) * 64));
        return (
          <div key={s.stage} className="flex flex-col items-center flex-1 gap-1">
            <span className="text-[10px] font-bold" style={{ color: s.cfg.color }}>{s.count}</span>
            <div className="w-full rounded-t-md" style={{ height: h, background: s.cfg.bg, border: `1px solid ${s.cfg.color}30` }} />
            <span className="text-[9px] text-[#9ca3af] text-center leading-tight">{s.stage}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CandidatesPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const pageRef = useRef(null);

  useGSAP(() => {
    gsap.from('.cand-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
    gsap.from('.cand-funnel', { opacity: 0, y: 20, duration: 0.45, delay: 0.15, ease: 'power2.out' });
  }, { scope: pageRef });

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api(`/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((d) => setRows(d.candidates || []))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetailLoading(true);
    api(`/candidates/${selected}`)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setDetailLoading(false));
  }, [selected]);

  const filtered = stageFilter
    ? rows.filter((r) =>
        r.stage_name?.toLowerCase().includes(stageFilter.toLowerCase()) ||
        r.application_status?.toLowerCase().includes(stageFilter.toLowerCase())
      )
    : rows;

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_300px_at_70%_-60px,rgba(139,92,246,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col p-6 md:p-8">
        {/* Header */}
        <div className="cand-header flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1F2023]">Candidates</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">{rows.length} in pipeline · ATS synced</p>
          </div>
        </div>

        {/* Pipeline funnel */}
        {rows.length > 0 && (
          <div className="cand-funnel rounded-2xl border border-[#E8EAED] bg-white p-5 mb-5 shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-[#1F2023]">Pipeline Overview</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setStageFilter('')}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${!stageFilter ? 'bg-[#0F766E] text-white' : 'bg-[#f3f4f6] text-[#6b7280] hover:bg-[#F0FDFA]'}`}
                >
                  All
                </button>
                {STAGE_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStageFilter(stageFilter === s ? '' : s)}
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium transition hover:opacity-80"
                    style={stageFilter === s
                      ? { background: STAGE_CONFIG[s].color, color: '#fff' }
                      : { background: STAGE_CONFIG[s].bg, color: STAGE_CONFIG[s].color }
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <PipelineFunnel candidates={rows} />
          </div>
        )}

        {/* Search */}
        <div className="relative mb-5 max-w-sm">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-2xl border border-[#E8EAED] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/10"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-5">
          {/* Candidates list */}
          <div className="overflow-auto rounded-2xl border border-[#E8EAED] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-3">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#F8F8FC] text-left text-[11px] uppercase tracking-wide text-[#9ca3af]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Candidate</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                  <th className="px-4 py-3 font-semibold">Next Interview</th>
                  <th className="px-1 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[#9ca3af]">Loading…</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#9ca3af]">
                      <UserRoundSearch size={32} className="mx-auto mb-2 opacity-40" />
                      No candidates found.
                    </td>
                  </tr>
                )}
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={`cursor-pointer border-t border-[#E8EAED] transition hover:bg-[#F7F8FA] ${
                      selected === c.id ? 'bg-[#F0FDFA]' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#0D9488] to-[#0F766E] text-xs font-bold text-white shrink-0">
                          {c.name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-[#1F2023]">{c.name}</div>
                          <div className="text-xs text-[#9ca3af]">{c.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-[#374151]">{c.job_title || '—'}</div>
                      {c.current_company && (
                        <div className="text-xs text-[#9ca3af]">{c.current_company}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={c.stage_name || c.application_status} />
                    </td>
                    <td className="px-4 py-3">
                      {c.next_interview ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-[#0891b2]">
                          <Calendar size={11} />
                          {formatDateTime(c.next_interview)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#d1d5db]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <ChevronRight size={14} className="text-[#d1d5db]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          <div className="overflow-auto rounded-2xl border border-[#E8EAED] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-2">
            {detailLoading && (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin" />
              </div>
            )}
            {!detail && !detailLoading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
                <UserRoundSearch size={36} strokeWidth={1.25} />
                <p className="text-sm text-center">Select a candidate to view their profile & interview history</p>
              </div>
            )}
            {detail && !detailLoading && (
              <div className="flex flex-col h-full">
                {/* Profile */}
                <div className="p-5 border-b border-[#E8EAED] bg-gradient-to-br from-[#faf5ff] to-white">
                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0D9488] to-[#0F766E] text-base font-bold text-white shadow-lg">
                      {detail.candidate.name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold text-[#1F2023]">{detail.candidate.name}</h2>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <StageBadge stage={detail.applications?.[0]?.stage_name || detail.candidate.status} />
                        {detail.candidate.category && (
                          <span className="rounded-full bg-[#faf5ff] border border-[#e9d5ff] px-2 py-0.5 text-[10px] font-medium text-[#7c3aed]">
                            {detail.candidate.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelected(null); setDetail(null); }}
                      className="rounded-lg p-1.5 hover:bg-[#faf5ff] text-[#9ca3af]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Contact info */}
                  <div className="space-y-1.5">
                    {detail.candidate.email && (
                      <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                        <Mail size={12} className="text-[#9ca3af]" />
                        {detail.candidate.email}
                      </div>
                    )}
                    {detail.candidate.phone && (
                      <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                        <Phone size={12} className="text-[#9ca3af]" />
                        {detail.candidate.phone}
                      </div>
                    )}
                    {detail.candidate.current_company && (
                      <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                        <Building2 size={12} className="text-[#9ca3af]" />
                        {detail.candidate.current_company}
                      </div>
                    )}
                    {detail.candidate.source && (
                      <div className="flex items-center gap-2 text-xs text-[#6b7280]">
                        <Star size={12} className="text-[#9ca3af]" />
                        Source: {detail.candidate.source}
                      </div>
                    )}
                  </div>
                </div>

                {/* Applications */}
                {detail.applications?.length > 0 && (
                  <div className="px-5 py-4 border-b border-[#E8EAED]">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-3">Applications</h3>
                    <div className="space-y-2">
                      {detail.applications.map((a, i) => (
                        <div key={i} className="rounded-xl border border-[#E8EAED] bg-[#F7F8FA] px-3.5 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-[#1F2023]">{a.job_title || 'Unknown Role'}</div>
                              <div className="text-xs text-[#9ca3af] mt-0.5">{a.status}</div>
                            </div>
                            <StageBadge stage={a.stage_name} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interviews */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-3">
                    Interview History ({detail.interviews?.length || 0})
                  </h3>
                  {!detail.interviews?.length ? (
                    <p className="text-sm text-[#9ca3af]">No interviews scheduled yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {detail.interviews.map((i, idx) => (
                        <div key={idx} className="rounded-xl border border-[#E8EAED] bg-[#F7F8FA] p-3.5">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="text-sm font-semibold text-[#1F2023]">
                                {i.round_label || `Round ${i.round_no || idx + 1}`}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] mt-0.5">
                                <Calendar size={11} />
                                {formatDateTime(i.scheduled_start) || '—'}
                              </div>
                            </div>
                            {i.result && (
                              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                i.result?.toLowerCase() === 'passed' || i.result?.toLowerCase() === 'selected'
                                  ? 'bg-green-50 text-green-700'
                                  : i.result?.toLowerCase() === 'failed' || i.result?.toLowerCase() === 'rejected'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}>
                                {i.result?.toLowerCase() === 'passed' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                                {i.result}
                              </span>
                            )}
                          </div>
                          {i.mode && (
                            <div className="text-xs text-[#9ca3af]">Mode: {i.mode}</div>
                          )}
                          {i.interviewer_names?.length > 0 && (
                            <div className="text-xs text-[#9ca3af]">
                              Interviewers: {i.interviewer_names.join(', ')}
                            </div>
                          )}
                          {i.meeting_link && (
                            <a
                              href={i.meeting_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0F766E] hover:underline"
                            >
                              Join Meeting →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
