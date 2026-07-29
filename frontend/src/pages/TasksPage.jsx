import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Search, CheckSquare, Filter, X, AlertCircle, Clock, CheckCircle2, Circle, LayoutGrid, List } from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

const STATUSES = ['Todo', 'In Progress', 'Done', 'Blocked', 'Backlog', 'Review'];
const PRIORITIES = ['High', 'Medium', 'Low', 'Critical'];

const STATUS_CONFIG = {
  'Done': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: CheckCircle2, iconColor: '#10b981' },
  'In Progress': { bg: 'bg-[#F0FDFA]', text: 'text-[#0F766E]', border: 'border-[#CCFBF1]', icon: Clock, iconColor: '#0F766E' },
  'Blocked': { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', icon: AlertCircle, iconColor: '#ef4444' },
  'Todo': { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', icon: Circle, iconColor: '#9ca3af' },
  'Backlog': { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', icon: Circle, iconColor: '#94a3b8' },
  'Review': { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', icon: Clock, iconColor: '#f59e0b' },
};

const PRIORITY_CONFIG = {
  Critical: 'bg-red-100 text-red-700',
  High: 'bg-orange-50 text-orange-700',
  Medium: 'bg-amber-50 text-amber-600',
  Low: 'bg-green-50 text-green-600',
};

function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  const today = new Date();
  const diff = Math.ceil((dt - today) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, overdue: true };
  if (diff === 0) return { label: 'Today', warning: true };
  if (diff === 1) return { label: 'Tomorrow', warning: true };
  return { label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false };
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['Todo'];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
      {status || 'Unknown'}
    </span>
  );
}

function TaskRow({ task, onStatusChange }) {
  const [updating, setUpdating] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const due = formatDate(task.due_date);
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG['Todo'];
  const Icon = cfg.icon;

  async function changeStatus(newStatus) {
    setStatusOpen(false);
    if (newStatus === task.status) return;
    setUpdating(true);
    try {
      await api(`/tasks/${task.id}/status`, { method: 'PATCH', body: { status: newStatus } });
      onStatusChange(task.id, newStatus);
    } catch (e) {
      console.error(e);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <tr className="border-t border-[#E8EAED] hover:bg-[#fafafa] transition group">
      <td className="px-5 py-3.5">
        <div className="flex items-start gap-3">
          <Icon size={16} strokeWidth={2} style={{ color: cfg.iconColor, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className={`text-sm font-medium ${task.status === 'Done' ? 'line-through text-[#9ca3af]' : 'text-[#1F2023]'}`}>
              {task.title}
            </div>
            {task.project_name && (
              <div className="text-xs text-[#9ca3af] mt-0.5">{task.project_name}</div>
            )}
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#0F766E] to-[#115E59] text-[10px] font-bold text-white">
            {task.employee_name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'}
          </div>
          <div>
            <div className="text-xs font-medium text-[#374151]">{task.employee_name || 'Unassigned'}</div>
          </div>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <div className="relative">
          <button
            disabled={updating}
            onClick={() => setStatusOpen((v) => !v)}
            className="focus:outline-none"
          >
            <StatusBadge status={updating ? '…' : task.status} />
          </button>
          {statusOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-36 rounded-xl border border-[#E8EAED] bg-white py-1 shadow-lg">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-[#F0FDFA] ${s === task.status ? 'font-semibold text-[#0F766E]' : 'text-[#374151]'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </td>
      <td className="px-5 py-3.5">
        {task.priority && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PRIORITY_CONFIG[task.priority] || 'bg-gray-50 text-gray-600'}`}>
            {task.priority}
          </span>
        )}
      </td>
      <td className="px-5 py-3.5">
        {due ? (
          <span className={`text-xs font-medium ${due.overdue ? 'text-red-500' : due.warning ? 'text-amber-500' : 'text-[#6b7280]'}`}>
            {due.label}
          </span>
        ) : (
          <span className="text-xs text-[#d1d5db]">—</span>
        )}
      </td>
    </tr>
  );
}

function KanbanColumn({ title, tasks, color, onStatusChange }) {
  const colRef = useRef(null);
  useGSAP(() => {
    gsap.from(colRef.current, { opacity: 0, y: 20, duration: 0.4, ease: 'power2.out' });
  }, { scope: colRef });

  return (
    <div ref={colRef} className="flex flex-col rounded-2xl border border-[#E8EAED] bg-[#F7F8FA] min-w-[220px] flex-1">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8EAED]">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-sm font-semibold text-[#1F2023]">{title}</span>
        </div>
        <span className="rounded-full bg-white border border-[#E8EAED] px-2 py-0.5 text-[11px] font-semibold text-[#9ca3af]">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3 overflow-y-auto max-h-[500px]">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="rounded-xl border border-[#E8EAED] bg-white p-3 shadow-sm hover:shadow-md transition cursor-default"
          >
            <div className={`text-sm font-medium leading-snug mb-2 ${task.status === 'Done' ? 'line-through text-[#9ca3af]' : 'text-[#1F2023]'}`}>
              {task.title}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#0F766E] to-[#115E59] text-[8px] font-bold text-white">
                  {task.employee_name?.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'}
                </div>
                <span className="text-[10px] text-[#9ca3af] truncate max-w-[80px]">{task.employee_name || '—'}</span>
              </div>
              {task.priority && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${PRIORITY_CONFIG[task.priority] || ''}`}>
                  {task.priority}
                </span>
              )}
            </div>
            {task.due_date && (() => {
              const due = formatDate(task.due_date);
              return due ? (
                <div className={`mt-1.5 text-[10px] font-medium ${due.overdue ? 'text-red-500' : due.warning ? 'text-amber-500' : 'text-[#9ca3af]'}`}>
                  {due.label}
                </div>
              ) : null;
            })()}
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="py-6 text-center text-xs text-[#d1d5db]">No tasks</div>
        )}
      </div>
    </div>
  );
}

const KANBAN_COLS = [
  { status: 'Todo', color: '#9ca3af' },
  { status: 'In Progress', color: '#0F766E' },
  { status: 'Review', color: '#f59e0b' },
  { status: 'Blocked', color: '#ef4444' },
  { status: 'Done', color: '#10b981' },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState('table');
  const pageRef = useRef(null);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api(`/tasks${params.toString() ? '?' + params : ''}`)
      .then((d) => setTasks(d.tasks || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [statusFilter]);

  useGSAP(() => {
    gsap.from('.tasks-header', { opacity: 0, y: -16, duration: 0.4, ease: 'power2.out' });
  }, { scope: pageRef });

  function handleStatusChange(id, newStatus) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus } : t));
  }

  const filtered = q
    ? tasks.filter((t) =>
        t.title?.toLowerCase().includes(q.toLowerCase()) ||
        t.employee_name?.toLowerCase().includes(q.toLowerCase()) ||
        t.project_name?.toLowerCase().includes(q.toLowerCase())
      )
    : tasks;

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = tasks.filter((t) => t.status === s).length;
    return acc;
  }, {});

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_250px_at_80%_-60px,rgba(239,68,68,0.07),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="tasks-header flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1F2023]">Tasks</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">Track & update all employee tasks</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('table')}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${view === 'table' ? 'border-[#0F766E]/30 bg-[#F0FDFA] text-[#0F766E]' : 'border-[#E8EAED] bg-white text-[#6b7280]'}`}
            >
              <List size={15} /> Table
            </button>
            <button
              onClick={() => setView('kanban')}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ${view === 'kanban' ? 'border-[#0F766E]/30 bg-[#F0FDFA] text-[#0F766E]' : 'border-[#E8EAED] bg-white text-[#6b7280]'}`}
            >
              <LayoutGrid size={15} /> Kanban
            </button>
          </div>
        </div>

        {/* Status pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setStatusFilter('')}
            className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${!statusFilter ? 'border-[#0F766E] bg-[#0F766E] text-white' : 'border-[#E8EAED] bg-white text-[#6b7280] hover:border-[#0F766E]/30'}`}
          >
            All ({tasks.length})
          </button>
          {Object.entries(counts).filter(([, c]) => c > 0).map(([s, c]) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition ${
                  statusFilter === s
                    ? `${cfg?.bg || 'bg-gray-50'} ${cfg?.text || 'text-gray-600'} ${cfg?.border || 'border-gray-200'}`
                    : 'border-[#E8EAED] bg-white text-[#6b7280] hover:border-[#0F766E]/30'
                }`}
              >
                {s} ({c})
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative mb-5 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, employees, projects…"
            className="w-full rounded-2xl border border-[#E8EAED] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/10"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-[#0F766E] border-t-transparent animate-spin" />
          </div>
        ) : view === 'table' ? (
          <div className="rounded-2xl border border-[#E8EAED] bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8F8FC] text-[11px] uppercase tracking-wide text-[#9ca3af] sticky top-0">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Task</th>
                    <th className="px-5 py-3 text-left font-semibold">Assigned To</th>
                    <th className="px-5 py-3 text-left font-semibold">Status</th>
                    <th className="px-5 py-3 text-left font-semibold">Priority</th>
                    <th className="px-5 py-3 text-left font-semibold">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-[#9ca3af]">
                        No tasks found. Run a sync to load data.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((task) => (
                      <TaskRow key={task.id} task={task} onStatusChange={handleStatusChange} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN_COLS.map(({ status, color }) => (
              <KanbanColumn
                key={status}
                title={status}
                color={color}
                tasks={filtered.filter((t) => (t.status || 'Todo') === status)}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
