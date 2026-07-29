import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  FileText, Search, ChevronDown, ChevronUp, CheckCircle2,
  AlertCircle, Clock, User, Calendar, Filter, X,
} from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_CHIP = {
  submitted: { bg: 'bg-green-50', text: 'text-green-700', label: 'Submitted' },
  late: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Late' },
  missing: { bg: 'bg-red-50', text: 'text-red-600', label: 'Missing' },
};

function StatusChip({ status }) {
  const s = STATUS_CHIP[status?.toLowerCase()] || { bg: 'bg-gray-50', text: 'text-gray-600', label: status || '—' };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function TaskItem({ task, index, reportId, taskType, onComplete }) {
  const [completing, setCompleting] = useState(false);
  const name = task?.task_title || task?.title || task?.name || (typeof task === 'string' ? task : `Task ${index + 1}`);
  const done = task?.completed || task?.status?.toLowerCase() === 'done' || task?.completed_by_manager;

  async function handleComplete() {
    setCompleting(true);
    try {
      await api(`/eod-reports/${reportId}/task-complete`, {
        method: 'PATCH',
        body: { taskIndex: index, taskType },
      });
      onComplete(index, taskType);
    } catch (e) {
      console.error(e);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
      done ? 'border-green-100 bg-green-50/50' : 'border-[#EDEDF5] bg-white'
    }`}>
      <button
        onClick={done ? undefined : handleComplete}
        disabled={done || completing}
        title={done ? 'Completed' : 'Mark complete'}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
          done
            ? 'border-green-500 bg-green-500 text-white'
            : 'border-[#d1d5db] hover:border-[#6c4dff] hover:bg-[#f3f0ff]'
        } ${completing ? 'opacity-50' : ''}`}
      >
        {done && <CheckCircle2 size={12} />}
      </button>
      <span className={`text-sm leading-relaxed ${done ? 'line-through text-[#9ca3af]' : 'text-[#1f1f2e]'}`}>
        {name}
      </span>
      {task?.completed_by_manager && (
        <span className="ml-auto shrink-0 text-[10px] font-medium text-[#6c4dff] bg-[#f3f0ff] rounded-full px-2 py-0.5">
          Approved
        </span>
      )}
    </div>
  );
}

function ReportCard({ report, onTaskComplete }) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);

  const tasks = Array.isArray(report.tasks_data) ? report.tasks_data : [];
  const pending = Array.isArray(report.pending_tasks_data) ? report.pending_tasks_data : [];
  const blockers = Array.isArray(report.blockers_data) ? report.blockers_data : [];
  const tomorrowPlan = Array.isArray(report.tomorrow_plan) ? report.tomorrow_plan : [];

  return (
    <div ref={cardRef} className="rounded-2xl border border-[#EDEDF5] bg-white shadow-[0_2px_8px_rgba(15,23,42,0.05)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-[#fafafa] transition text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-xs font-bold text-white">
          {report.employee_name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[#1f1f2e]">{report.employee_name}</span>
            <StatusChip status={report.status} />
            {blockers.length > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">
                <AlertCircle size={10} /> {blockers.length} blocker{blockers.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[#9ca3af]">
            <span className="flex items-center gap-1"><Calendar size={11} /> {formatDate(report.report_date)}</span>
            <span className="flex items-center gap-1"><User size={11} /> {report.employee_role || 'Employee'}</span>
            {report.working_mode && <span className="flex items-center gap-1"><Clock size={11} /> {report.working_mode}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right text-xs text-[#9ca3af]">
            <div>{tasks.length} tasks</div>
            {pending.length > 0 && <div className="text-amber-500">{pending.length} pending</div>}
          </div>
          {open ? <ChevronUp size={16} className="text-[#9ca3af]" /> : <ChevronDown size={16} className="text-[#9ca3af]" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-[#EDEDF5] px-5 py-5 space-y-5">
          {report.achievements && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-2">Achievements</h4>
              <p className="text-sm text-[#374151] leading-relaxed">{report.achievements}</p>
            </div>
          )}

          {tasks.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-2">
                Today's Tasks ({tasks.filter((t) => t?.completed || t?.completed_by_manager).length}/{tasks.length} done)
              </h4>
              <div className="space-y-2">
                {tasks.map((task, i) => (
                  <TaskItem
                    key={i}
                    task={task}
                    index={i}
                    reportId={report.id}
                    taskType="tasks_data"
                    onComplete={onTaskComplete}
                  />
                ))}
              </div>
            </div>
          )}

          {pending.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-2">
                Pending Tasks ({pending.length})
              </h4>
              <div className="space-y-2">
                {pending.map((task, i) => (
                  <TaskItem
                    key={i}
                    task={task}
                    index={i}
                    reportId={report.id}
                    taskType="pending_tasks_data"
                    onComplete={onTaskComplete}
                  />
                ))}
              </div>
            </div>
          )}

          {blockers.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-red-500 mb-2 flex items-center gap-1">
                <AlertCircle size={12} /> Blockers
              </h4>
              <div className="space-y-2">
                {blockers.map((b, i) => (
                  <div key={i} className="rounded-xl border border-red-100 bg-red-50/60 px-3.5 py-3 text-sm text-red-700">
                    {b?.blocker || b?.description || b?.title || (typeof b === 'string' ? b : `Blocker ${i + 1}`)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tomorrowPlan.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-2">
                Tomorrow's Plan
              </h4>
              <div className="space-y-1.5">
                {tomorrowPlan.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-[#374151]">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#6c4dff] shrink-0" />
                    {p?.task || p?.title || p?.description || (typeof p === 'string' ? p : `Task ${i + 1}`)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.self_evaluation && typeof report.self_evaluation === 'object' && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-2">Self Evaluation</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(report.self_evaluation).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-[#f7f7fb] px-3 py-2">
                    <div className="text-[10px] text-[#9ca3af] capitalize">{k.replace(/_/g, ' ')}</div>
                    <div className="text-sm font-semibold text-[#1f1f2e]">{String(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EodReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const pageRef = useRef(null);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    api(`/eod-reports${params.toString() ? '?' + params : ''}`)
      .then((d) => setReports(d.reports || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  useGSAP(() => {
    gsap.from('.eod-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
  }, { scope: pageRef });

  const filtered = q
    ? reports.filter(
        (r) =>
          r.employee_name?.toLowerCase().includes(q.toLowerCase()) ||
          r.employee_email?.toLowerCase().includes(q.toLowerCase())
      )
    : reports;

  const today = new Date().toISOString().slice(0, 10);
  const todayReports = filtered.filter((r) => r.report_date?.slice(0, 10) === today);
  const olderReports = filtered.filter((r) => r.report_date?.slice(0, 10) !== today);

  function handleTaskComplete(reportId) {
    // Re-fetch to get fresh data
    load();
  }

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_250px_at_30%_-60px,rgba(245,158,11,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="eod-header flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1f1f2e]">EOD Reports</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              Read daily reports · mark tasks complete · track blockers
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-amber-50 border border-amber-100 px-3 py-1.5 text-sm font-medium text-amber-700">
              {filtered.length} reports
            </span>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                filterOpen || dateFrom || dateTo
                  ? 'border-[#6c4dff]/30 bg-[#f3f0ff] text-[#6c4dff]'
                  : 'border-[#EDEDF5] bg-white text-[#6b7280] hover:border-[#6c4dff]/30'
              }`}
            >
              <Filter size={14} />
              Filters
              {(dateFrom || dateTo) && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#6c4dff] text-[9px] font-bold text-white">
                  {(dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filters */}
        {filterOpen && (
          <div className="mb-5 rounded-2xl border border-[#EDEDF5] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-xl border border-[#EDEDF5] bg-[#f7f7fb] px-3 py-2 text-sm outline-none focus:border-[#6c4dff]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-xl border border-[#EDEDF5] bg-[#f7f7fb] px-3 py-2 text-sm outline-none focus:border-[#6c4dff]"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="flex items-center gap-1.5 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600 hover:bg-red-100"
                >
                  <X size={14} /> Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-5 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by employee name or email…"
            className="w-full rounded-2xl border border-[#EDEDF5] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#6c4dff] focus:ring-2 focus:ring-[#6c4dff]/10"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-[#6c4dff] border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-[#9ca3af]">
            <FileText size={40} strokeWidth={1.25} />
            <p className="text-sm">No EOD reports found. Sync data first.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {todayReports.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1f1f2e]">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Today's Reports ({todayReports.length})
                </h2>
                <div className="space-y-3">
                  {todayReports.map((r) => (
                    <ReportCard key={r.id} report={r} onTaskComplete={() => load()} />
                  ))}
                </div>
              </div>
            )}
            {olderReports.length > 0 && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#6b7280]">
                  <span className="h-2 w-2 rounded-full bg-[#d1d5db]" />
                  Earlier Reports ({olderReports.length})
                </h2>
                <div className="space-y-3">
                  {olderReports.map((r) => (
                    <ReportCard key={r.id} report={r} onTaskComplete={() => load()} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
