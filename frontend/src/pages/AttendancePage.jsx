import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Fingerprint, Search, Clock, UserX, UserCheck, AlertTriangle,
  Calendar, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

function formatTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

const STATUS_STYLE = {
  Present: 'bg-green-50 text-green-700',
  Late: 'bg-amber-50 text-amber-700',
  Absent: 'bg-red-50 text-red-600',
  'Half Day': 'bg-sky-50 text-sky-700',
  'On Leave': 'bg-violet-50 text-violet-700',
  Holiday: 'bg-gray-50 text-gray-600',
};

export default function AttendancePage() {
  const [today, setToday] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState({ days: [], punches: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const pageRef = useRef(null);

  function loadForDate(d) {
    const day = d || date;
    setLoading(true);
    setError('');
    const month = day.slice(0, 7);
    Promise.all([
      api(`/attendance?from=${day}&to=${day}`),
      api(`/attendance/summary?month=${month}`),
    ])
      .then(([range, s]) => {
        const rows = range.days || [];
        setToday({
          date: day,
          rows,
          counts: {
            present: rows.filter((r) => ['Present', 'Late', 'Half Day'].includes(r.status)).length,
            absent: rows.filter((r) => r.status === 'Absent').length,
            late: rows.filter((r) => r.status === 'Late').length,
            on_leave: rows.filter((r) => r.status === 'On Leave').length,
            total: rows.length,
          },
        });
        setSummary(s);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadForDate(date);
  }, [date]);

  function loadToday() {
    loadForDate(date);
  }

  useEffect(() => {
    if (!selected) {
      setDetail({ days: [], punches: [] });
      return;
    }
    const month = (date || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const from = `${month}-01`;
    const to = date || new Date().toISOString().slice(0, 10);
    api(`/attendance?employee_id=${selected}&from=${from}&to=${to}`)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [selected, date]);

  useGSAP(() => {
    gsap.from('.att-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
    gsap.from('.att-kpi', { opacity: 0, y: 16, duration: 0.4, stagger: 0.05, ease: 'power2.out', delay: 0.1 });
  }, { scope: pageRef, dependencies: [loading] });

  const rows = (today?.rows || []).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return r.employee_name?.toLowerCase().includes(s) || r.employee_email?.toLowerCase().includes(s);
  });

  const c = today?.counts || {};

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_280px_at_40%_-60px,rgba(16,185,129,0.12),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        <div className="att-header flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1f1f2e]">Attendance</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              Biometric punches · present / absent / late · IST
            </p>
          </div>
          <button
            onClick={loadToday}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-[#EDEDF5] bg-white px-3.5 py-2 text-sm font-medium text-[#6b7280] hover:border-[#10b981]/40 hover:text-[#10b981] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
          {[
            { label: 'Present', value: c.present ?? '—', icon: UserCheck, color: '#10b981' },
            { label: 'Absent', value: c.absent ?? '—', icon: UserX, color: '#ef4444' },
            { label: 'Late', value: c.late ?? '—', icon: AlertTriangle, color: '#f59e0b' },
            { label: 'On Leave', value: c.on_leave ?? '—', icon: Calendar, color: '#8b5cf6' },
          ].map((k) => (
            <div key={k.label} className="att-kpi rounded-2xl border border-[#EDEDF5] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${k.color}18` }}>
                  <k.icon size={16} style={{ color: k.color }} />
                </div>
                <span className="text-xs font-medium text-[#9ca3af]">{k.label}</span>
              </div>
              <div className="text-2xl font-bold text-[#1f1f2e] tabular-nums">{k.value}</div>
              <div className="text-[11px] text-[#9ca3af] mt-0.5">{today?.date || 'Today'}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search employee…"
              className="w-full rounded-2xl border border-[#EDEDF5] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/10"
            />
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-[#EDEDF5] bg-white px-3 py-2 text-sm outline-none focus:border-[#10b981]"
          />
        </div>

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-5">
          <div className="overflow-auto rounded-2xl border border-[#EDEDF5] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-3">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-7 w-7 rounded-full border-2 border-[#10b981] border-t-transparent animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-[#9ca3af]">
                <Fingerprint size={36} strokeWidth={1.25} />
                <p className="text-sm text-center px-6">
                  No attendance for this day. Run an Attendance sync from Data Sync.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#F8F8FC] text-[11px] uppercase tracking-wide text-[#9ca3af]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Employee</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                    <th className="px-4 py-3 text-left font-semibold">In</th>
                    <th className="px-4 py-3 text-left font-semibold">Out</th>
                    <th className="px-4 py-3 text-left font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id || `${r.employee_id}-${r.work_date}`}
                      onClick={() => setSelected(r.employee_id)}
                      className={`cursor-pointer border-t border-[#EDEDF5] hover:bg-[#f7f7fb] ${
                        selected === r.employee_id ? 'bg-[#ecfdf5]' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#1f1f2e]">{r.employee_name}</div>
                        <div className="text-xs text-[#9ca3af]">{r.employee_email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status] || 'bg-gray-50 text-gray-600'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6b7280] tabular-nums">{formatTime(r.first_in)}</td>
                      <td className="px-4 py-3 text-[#6b7280] tabular-nums">{formatTime(r.last_out)}</td>
                      <td className="px-4 py-3 font-medium tabular-nums">
                        {r.hours_worked != null ? Number(r.hours_worked).toFixed(1) : '—'}
                        {r.late_minutes > 0 && (
                          <span className="ml-1 text-[10px] text-amber-600">+{r.late_minutes}m late</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="overflow-auto rounded-2xl border border-[#EDEDF5] bg-white p-5 shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-2">
            {!selected ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-[#9ca3af]">
                <Clock size={32} strokeWidth={1.25} />
                <p className="text-sm text-center">Select an employee to see month days & punches</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-[#1f1f2e]">Month days</h3>
                  <p className="text-xs text-[#9ca3af]">Through {formatDate(date)}</p>
                </div>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {(detail.days || []).slice(0, 31).map((d) => (
                    <li key={d.id || d.work_date} className="flex items-center justify-between text-sm border-b border-[#EDEDF5] pb-2">
                      <span className="text-[#6b7280]">{formatDate(d.work_date)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[d.status] || ''}`}>
                        {d.status}
                      </span>
                      <span className="text-xs tabular-nums text-[#9ca3af]">{formatTime(d.first_in)}</span>
                    </li>
                  ))}
                  {!detail.days?.length && <li className="text-sm text-[#9ca3af]">No day records</li>}
                </ul>

                <div>
                  <h3 className="font-semibold text-[#1f1f2e] mb-2">Punches</h3>
                  <ul className="space-y-2 max-h-56 overflow-y-auto">
                    {(detail.punches || []).slice(0, 40).map((p) => (
                      <li key={p.id} className="flex items-center justify-between text-sm">
                        <span className="text-[#1f1f2e] tabular-nums">
                          {new Date(p.punch_time).toLocaleString('en-IN', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.punch_type === 'IN' ? 'bg-green-50 text-green-700' :
                          p.punch_type === 'OUT' ? 'bg-sky-50 text-sky-700' : 'bg-gray-50 text-gray-600'
                        }`}>
                          {p.punch_type}
                        </span>
                      </li>
                    ))}
                    {!detail.punches?.length && <li className="text-sm text-[#9ca3af]">No punches in range</li>}
                  </ul>
                </div>

                {summary?.employees?.length > 0 && (
                  <div className="rounded-xl bg-[#f7f7fb] p-3 text-xs text-[#6b7280]">
                    Month summary loaded for {summary.employees.length} people ·{' '}
                    {Object.entries(summary.by_status || {}).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
