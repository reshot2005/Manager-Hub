import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Users, CheckSquare, FileText, Calendar,
  TrendingUp, UserCheck, ArrowUpRight, RefreshCw,
  UserX, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

gsap.registerPlugin(useGSAP);

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function KpiCard({ icon: Icon, label, value, sub, color, delay = 0 }) {
  const cardRef = useRef(null);
  useGSAP(() => {
    gsap.from(cardRef.current, {
      opacity: 0, y: 24, duration: 0.45, ease: 'power2.out', delay,
    });
  }, { scope: cardRef });

  return (
    <div
      ref={cardRef}
      className="rounded-2xl bg-white border border-[#E8EAED] p-5 shadow-[0_2px_12px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${color}18` }}
        >
          <Icon size={20} style={{ color }} strokeWidth={2} />
        </div>
        <ArrowUpRight size={16} className="text-[#d1d5db]" />
      </div>
      <div className="text-3xl font-bold text-[#1F2023] tabular-nums">{value ?? '—'}</div>
      <div className="mt-1 text-sm font-medium text-[#6b7280]">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-[#9ca3af]">{sub}</div>}
    </div>
  );
}

function MiniBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#6b7280] font-medium">{label}</span>
        <span className="font-semibold text-[#1F2023]">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-[#f3f4f6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function EodTrendChart({ data }) {
  if (!data?.length) return <p className="text-sm text-[#9ca3af] mt-4">No EOD data this week.</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-2 h-24 mt-4">
      {data.map((d) => {
        const h = Math.max(8, Math.round((d.count / max) * 80));
        return (
          <div key={d.date} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[10px] font-semibold text-[#0F766E]">{d.count}</span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-[#0F766E] to-[#5EEAD4]"
              style={{ height: h }}
            />
            <span className="text-[9px] text-[#9ca3af] text-center leading-tight">
              {d.date?.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const STATUS_COLORS = {
  Done: '#10b981',
  'In Progress': '#0F766E',
  Todo: '#f59e0b',
  Backlog: '#9ca3af',
  Blocked: '#ef4444',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageRef = useRef(null);

  function load() {
    setLoading(true);
    api('/dashboard/stats')
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useGSAP(() => {
    if (!loading && stats) {
      gsap.from('.section-title', {
        opacity: 0, y: 12, duration: 0.4, stagger: 0.1, ease: 'power2.out',
      });
    }
  }, { scope: pageRef, dependencies: [loading] });

  const c = stats?.counts || {};
  const totalTasks = (c.open_tasks || 0) + (c.done_tasks || 0);

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_300px_at_60%_-80px,rgba(15,118,110,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1F2023]">Dashboard</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              Real-time overview · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-[#E8EAED] bg-white px-4 py-2 text-sm font-medium text-[#6b7280] shadow-sm transition hover:border-[#0F766E]/30 hover:text-[#0F766E] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && !stats ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
              <span className="text-sm text-[#9ca3af]">Loading stats…</span>
            </div>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-6">
              <KpiCard icon={Users} label="Employees" value={c.total_employees} sub="Active members" color="#0F766E" delay={0} />
              <KpiCard icon={UserCheck} label="Present Today" value={c.present_today} sub={`${c.late_today || 0} late`} color="#10b981" delay={0.05} />
              <KpiCard icon={UserX} label="Absent Today" value={c.absent_today} sub="No punch / marked absent" color="#ef4444" delay={0.1} />
              <KpiCard icon={Clock} label="Late Today" value={c.late_today} sub="After shift start" color="#f59e0b" delay={0.15} />
              <KpiCard icon={CheckSquare} label="Open Tasks" value={c.open_tasks} sub={`${c.done_tasks || 0} completed`} color="#ef4444" delay={0.2} />
              <KpiCard icon={FileText} label="EOD Today" value={c.eod_today} sub={`${c.eod_this_week || 0} this week`} color="#f59e0b" delay={0.25} />
              <KpiCard icon={Calendar} label="Interviews" value={c.upcoming_interviews} sub="Upcoming" color="#06b6d4" delay={0.3} />
              <KpiCard icon={TrendingUp} label="Completion" value={totalTasks ? `${Math.round((c.done_tasks / totalTasks) * 100)}%` : '—'} sub="Task completion rate" color="#0ea5e9" delay={0.35} />
            </div>

            {/* Charts row */}
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              {/* EOD Trend */}
              <div className="rounded-2xl bg-white border border-[#E8EAED] p-5 shadow-[0_2px_12px_rgba(15,23,42,0.06)] md:col-span-2">
                <div className="section-title flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-[#1F2023]">EOD Submission Trend</h3>
                    <p className="text-xs text-[#9ca3af] mt-0.5">Last 7 days</p>
                  </div>
                  <span className="rounded-full bg-[#F0FDFA] px-2.5 py-1 text-xs font-medium text-[#0F766E]">
                    {stats?.eodTrend?.reduce((s, d) => s + d.count, 0) || 0} total
                  </span>
                </div>
                <EodTrendChart data={stats?.eodTrend} />
              </div>

              {/* Task Status */}
              <div className="rounded-2xl bg-white border border-[#E8EAED] p-5 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
                <div className="section-title mb-4">
                  <h3 className="font-semibold text-[#1F2023]">Task Breakdown</h3>
                  <p className="text-xs text-[#9ca3af] mt-0.5">By status</p>
                </div>
                {stats?.taskStatus?.length ? (
                  stats.taskStatus.slice(0, 6).map((s) => (
                    <MiniBar
                      key={s.status}
                      label={s.status}
                      value={s.count}
                      max={totalTasks}
                      color={STATUS_COLORS[s.status] || '#0F766E'}
                    />
                  ))
                ) : (
                  <p className="text-sm text-[#9ca3af]">No task data yet.</p>
                )}
              </div>
            </div>

            {/* Top employees */}
            <div className="rounded-2xl bg-white border border-[#E8EAED] shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
              <div className="section-title flex items-center justify-between px-5 py-4 border-b border-[#E8EAED]">
                <h3 className="font-semibold text-[#1F2023]">Team Overview</h3>
                <span className="text-xs text-[#9ca3af]">Sorted by open tasks</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#F8F8FC] text-[11px] uppercase tracking-wide text-[#9ca3af]">
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Employee</th>
                      <th className="px-5 py-3 text-left font-semibold">Open Tasks</th>
                      <th className="px-5 py-3 text-left font-semibold">Last EOD</th>
                      <th className="px-5 py-3 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.topByTasks?.length ? (
                      stats.topByTasks.map((e, i) => (
                        <tr key={i} className="border-t border-[#E8EAED] hover:bg-[#fafafa]">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#0F766E] to-[#115E59] text-xs font-bold text-white">
                                {e.name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-[#1F2023]">{e.name}</div>
                                <div className="text-xs text-[#9ca3af]">{e.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`font-bold tabular-nums ${e.open_tasks > 5 ? 'text-red-500' : e.open_tasks > 2 ? 'text-amber-500' : 'text-[#10b981]'}`}>
                              {e.open_tasks}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-[#6b7280]">{formatDate(e.last_eod) || '—'}</td>
                          <td className="px-5 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              e.last_eod
                                ? 'bg-[#dcfce7] text-[#15803d]'
                                : 'bg-[#fef3c7] text-[#92400e]'
                            }`}>
                              {e.last_eod ? 'EOD Submitted' : 'Pending EOD'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-5 py-10 text-center text-[#9ca3af]">
                          No employee data. Run a sync first.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
