import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Search, Users, CheckSquare, FileText, X, ChevronRight,
  Circle, CheckCircle2, Clock, AlertCircle, Mail, Shield,
} from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TASK_STATUS_COLOR = {
  Done: '#10b981',
  'In Progress': '#6c4dff',
  Blocked: '#ef4444',
  Todo: '#9ca3af',
  Review: '#f59e0b',
};

function TaskPill({ status }) {
  const color = TASK_STATUS_COLOR[status] || '#6b7280';
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `${color}18`, color }}
    >
      {status || 'Unknown'}
    </span>
  );
}

function EodSection({ eods }) {
  const [expanded, setExpanded] = useState(null);

  if (!eods?.length) return <p className="text-sm text-[#9ca3af]">No EOD reports found.</p>;

  return (
    <div className="space-y-2">
      {eods.slice(0, 8).map((e, i) => {
        const tasks = Array.isArray(e.tasks_data) ? e.tasks_data : [];
        const blockers = Array.isArray(e.blockers_data) ? e.blockers_data : [];
        const isOpen = expanded === i;

        return (
          <div
            key={i}
            className="rounded-xl border border-[#EDEDF5] bg-[#f7f7fb] overflow-hidden"
          >
            <button
              onClick={() => setExpanded(isOpen ? null : i)}
              className="w-full flex items-center justify-between px-3.5 py-3 text-left hover:bg-[#f0f0fa]"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${
                  e.status?.toLowerCase() === 'submitted' ? 'bg-green-500' :
                  e.status?.toLowerCase() === 'late' ? 'bg-amber-400' : 'bg-[#d1d5db]'
                }`} />
                <span className="text-sm font-semibold text-[#1f1f2e]">{formatDate(e.report_date)}</span>
                {blockers.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-500">
                    <AlertCircle size={10} /> {blockers.length} blocker
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#9ca3af]">{tasks.length} tasks</span>
                <ChevronRight size={14} className={`text-[#9ca3af] transition ${isOpen ? 'rotate-90' : ''}`} />
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-[#EDEDF5] px-3.5 py-3 space-y-3 bg-white">
                {e.achievements && (
                  <p className="text-xs text-[#374151] leading-relaxed">{e.achievements}</p>
                )}
                {tasks.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-1.5">Tasks</div>
                    <div className="space-y-1.5">
                      {tasks.slice(0, 6).map((t, ti) => (
                        <div key={ti} className="flex items-center gap-2 text-xs text-[#374151]">
                          {t?.completed || t?.completed_by_manager ? (
                            <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                          ) : (
                            <Circle size={12} className="text-[#d1d5db] shrink-0" />
                          )}
                          <span className={t?.completed || t?.completed_by_manager ? 'line-through text-[#9ca3af]' : ''}>
                            {t?.task_title || t?.title || t?.name || (typeof t === 'string' ? t : `Task ${ti + 1}`)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {blockers.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1.5">Blockers</div>
                    {blockers.map((b, bi) => (
                      <div key={bi} className="rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 mb-1">
                        {b?.blocker || b?.description || b?.title || (typeof b === 'string' ? b : `Blocker ${bi + 1}`)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EmployeesPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('tasks');
  const pageRef = useRef(null);
  const detailRef = useRef(null);

  useGSAP(() => {
    gsap.from('.emp-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
    gsap.from('.emp-table-wrap', { opacity: 0, y: 20, duration: 0.45, delay: 0.1, ease: 'power2.out' });
  }, { scope: pageRef });

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api(`/employees${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((d) => setRows(d.employees || []))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetailLoading(true);
    api(`/employees/${selected}`)
      .then((d) => {
        setDetail(d);
        if (detailRef.current) {
          gsap.from(detailRef.current, { opacity: 0, x: 20, duration: 0.3, ease: 'power2.out' });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setDetailLoading(false));
  }, [selected]);

  const eodMissing = rows.filter((r) => {
    if (!r.last_eod_date) return true;
    const today = new Date().toISOString().slice(0, 10);
    return r.last_eod_date?.slice(0, 10) !== today;
  }).length;

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_300px_at_20%_-60px,rgba(16,185,129,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col p-6 md:p-8">
        {/* Header */}
        <div className="emp-header flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1f1f2e]">Employees</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              {rows.length} active ·{' '}
              {eodMissing > 0 ? (
                <span className="text-amber-500 font-medium">{eodMissing} missing EOD today</span>
              ) : rows.length > 0 ? (
                <span className="text-green-600 font-medium">All EODs in ✓</span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5 max-w-sm">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-2xl border border-[#EDEDF5] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/10"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-5">
          {/* List */}
          <div className="emp-table-wrap overflow-auto rounded-2xl border border-[#EDEDF5] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-3">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#F8F8FC] text-left text-[11px] uppercase tracking-wide text-[#9ca3af]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Open Tasks</th>
                  <th className="px-4 py-3 font-semibold">Last EOD</th>
                  <th className="px-4 py-3 font-semibold">EOD Status</th>
                  <th className="px-1 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-[#9ca3af]">Loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[#9ca3af]">
                      <Users size={32} className="mx-auto mb-2 opacity-40" />
                      No employees yet. Run a sync.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const todayEod = r.last_eod_date?.slice(0, 10) === new Date().toISOString().slice(0, 10);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => { setSelected(r.id); setActiveTab('tasks'); }}
                      className={`cursor-pointer border-t border-[#EDEDF5] transition hover:bg-[#f7f7fb] ${
                        selected === r.id ? 'bg-[#f3f0ff]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-xs font-bold text-white shrink-0">
                            {r.name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-[#1f1f2e]">{r.name}</div>
                            <div className="text-xs text-[#9ca3af]">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold tabular-nums ${
                          r.open_tasks > 5 ? 'text-red-500' :
                          r.open_tasks > 2 ? 'text-amber-500' : 'text-[#10b981]'
                        }`}>
                          {r.open_tasks ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6b7280] text-xs">{formatDate(r.last_eod_date)}</td>
                      <td className="px-4 py-3">
                        {todayEod ? (
                          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                            <CheckCircle2 size={10} /> {r.last_eod_status || 'Submitted'}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                            <Clock size={10} /> Pending
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <ChevronRight size={14} className="text-[#d1d5db]" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          <div
            ref={detailRef}
            className="overflow-auto rounded-2xl border border-[#EDEDF5] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-2"
          >
            {detailLoading && (
              <div className="flex h-full items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-[#6c4dff] border-t-transparent animate-spin" />
              </div>
            )}
            {!detail && !detailLoading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[#9ca3af] p-8">
                <Users size={36} strokeWidth={1.25} />
                <p className="text-sm text-center">Click an employee to view tasks & EOD reports</p>
              </div>
            )}
            {detail && !detailLoading && (
              <div className="flex flex-col h-full">
                {/* Profile header */}
                <div className="p-5 border-b border-[#EDEDF5] bg-gradient-to-br from-[#f3f0ff] to-white">
                  <div className="flex items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-base font-bold text-white shadow-lg">
                      {detail.employee.name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-bold text-[#1f1f2e]">{detail.employee.name}</h2>
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[#9ca3af]">
                        <Shield size={11} />
                        {detail.employee.role || 'Employee'}
                        {detail.employee.department && ` · ${detail.employee.department}`}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[#9ca3af]">
                        <Mail size={11} />
                        {detail.employee.email || '—'}
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelected(null); setDetail(null); }}
                      className="rounded-lg p-1.5 hover:bg-[#f3f0ff] text-[#9ca3af]"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Quick stats */}
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="rounded-xl bg-white border border-[#EDEDF5] px-3 py-2 text-center">
                      <div className="text-lg font-bold text-[#6c4dff]">{detail.tasks?.length || 0}</div>
                      <div className="text-[10px] text-[#9ca3af]">Tasks</div>
                    </div>
                    <div className="rounded-xl bg-white border border-[#EDEDF5] px-3 py-2 text-center">
                      <div className="text-lg font-bold text-[#f59e0b]">{detail.eods?.length || 0}</div>
                      <div className="text-[10px] text-[#9ca3af]">EOD Reports</div>
                    </div>
                    <div className="rounded-xl bg-white border border-[#EDEDF5] px-3 py-2 text-center">
                      <div className="text-lg font-bold text-[#ef4444]">
                        {detail.tasks?.filter((t) => TASK_STATUS_COLOR[t.status] === '#ef4444').length || 0}
                      </div>
                      <div className="text-[10px] text-[#9ca3af]">Blocked</div>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[#EDEDF5]">
                  {[
                    { id: 'tasks', label: 'Tasks', count: detail.tasks?.length },
                    { id: 'eod', label: 'EOD Reports', count: detail.eods?.length },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 px-4 py-3 text-sm font-medium transition border-b-2 ${
                        activeTab === tab.id
                          ? 'border-[#6c4dff] text-[#6c4dff]'
                          : 'border-transparent text-[#9ca3af] hover:text-[#6b7280]'
                      }`}
                    >
                      {tab.label}
                      {tab.count != null && (
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          activeTab === tab.id ? 'bg-[#f3f0ff] text-[#6c4dff]' : 'bg-[#f3f4f6] text-[#9ca3af]'
                        }`}>
                          {tab.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto p-5">
                  {activeTab === 'tasks' && (
                    <div className="space-y-2">
                      {!detail.tasks?.length && (
                        <p className="text-sm text-[#9ca3af]">No tasks assigned.</p>
                      )}
                      {(detail.tasks || []).slice(0, 20).map((t, i) => (
                        <div
                          key={i}
                          className="flex items-start justify-between gap-3 rounded-xl border border-[#EDEDF5] bg-[#f7f7fb] px-3.5 py-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-medium leading-snug ${t.status === 'Done' ? 'line-through text-[#9ca3af]' : 'text-[#1f1f2e]'}`}>
                              {t.title}
                            </div>
                            {t.project_name && (
                              <div className="text-xs text-[#9ca3af] mt-0.5">{t.project_name}</div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <TaskPill status={t.status} />
                            {t.due_date && (
                              <span className="text-[10px] text-[#9ca3af]">{formatDate(t.due_date)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeTab === 'eod' && <EodSection eods={detail.eods} />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
