import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Activity, RefreshCw, CheckCircle2, XCircle, Clock, Database,
  Users, CheckSquare, FileText, UserRoundSearch, Briefcase, Calendar,
  Zap, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

gsap.registerPlugin(useGSAP);

function formatTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function duration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_CONFIG = {
  success: { bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle2, dot: '#10b981' },
  error: { bg: 'bg-red-50', text: 'text-red-600', icon: XCircle, dot: '#ef4444' },
  running: { bg: 'bg-[#f3f0ff]', text: 'text-[#6c4dff]', icon: RefreshCw, dot: '#6c4dff' },
};

function RunRow({ run }) {
  const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.running;
  const Icon = cfg.icon;
  const stats = run.stats || {};

  return (
    <div className="rounded-2xl border border-[#EDEDF5] bg-white p-4 shadow-[0_1px_6px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: cfg.dot }} />
          <span className="font-semibold text-[#1f1f2e] capitalize">{run.source}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
            {run.status}
          </span>
        </div>
        <span className="text-xs text-[#9ca3af] tabular-nums">
          {duration(run.started_at, run.finished_at) || '…'}
        </span>
      </div>

      <div className="text-xs text-[#9ca3af] mb-2">{formatTime(run.started_at)}</div>

      {Object.keys(stats).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(stats).map(([k, v]) => (
            <span key={k} className="rounded-full bg-[#f7f7fb] border border-[#EDEDF5] px-2 py-0.5 text-[10px] font-medium text-[#6b7280]">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}

      {run.error_message && (
        <div className="mt-2 rounded-lg bg-red-50 border border-red-100 px-2.5 py-2 text-xs text-red-600">
          {run.error_message}
        </div>
      )}
    </div>
  );
}

const RECORD_ICONS = {
  employees: { icon: Users, color: '#6c4dff', label: 'Employees' },
  tasks: { icon: CheckSquare, color: '#ef4444', label: 'Tasks' },
  eod_reports: { icon: FileText, color: '#f59e0b', label: 'EOD Reports' },
  candidates: { icon: UserRoundSearch, color: '#8b5cf6', label: 'Candidates' },
  applications: { icon: Briefcase, color: '#10b981', label: 'Applications' },
  interviews: { icon: Calendar, color: '#06b6d4', label: 'Interviews' },
  jobs: { icon: Briefcase, color: '#6366f1', label: 'Jobs' },
  attendance_punches: { icon: Activity, color: '#059669', label: 'Punches' },
  attendance_days: { icon: Activity, color: '#10b981', label: 'Attendance Days' },
};

function CountCard({ name, count }) {
  const cfg = RECORD_ICONS[name] || { icon: Database, color: '#9ca3af', label: name };
  const Icon = cfg.icon;
  return (
    <div className="rounded-2xl border border-[#EDEDF5] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${cfg.color}15` }}>
          <Icon size={18} style={{ color: cfg.color }} strokeWidth={2} />
        </div>
        <span className="text-sm font-medium text-[#6b7280]">{cfg.label}</span>
      </div>
      <div className="text-2xl font-bold text-[#1f1f2e] tabular-nums ml-0.5">{count?.toLocaleString() ?? '—'}</div>
    </div>
  );
}

export default function SyncPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncSource, setSyncSource] = useState('all');
  const [error, setError] = useState('');
  const [syncResult, setSyncResult] = useState(null);
  const pageRef = useRef(null);

  function loadStatus() {
    setLoading(true);
    api('/sync/status')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadStatus(); }, []);

  useGSAP(() => {
    if (!loading) {
      gsap.from('.sync-count-card', {
        opacity: 0, y: 20, duration: 0.4, stagger: 0.06, ease: 'power2.out',
      });
      gsap.from('.sync-run-row', {
        opacity: 0, x: -16, duration: 0.35, stagger: 0.05, ease: 'power2.out', delay: 0.2,
      });
    }
  }, { scope: pageRef, dependencies: [loading] });

  async function runSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    setError('');
    try {
      const result = await api('/sync/run', {
        method: 'POST',
        body: syncSource !== 'all' ? { source: syncSource } : {},
      });
      setSyncResult(result);
      await loadStatus();
    } catch (e) {
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const isAdmin = user?.role === 'ADMIN';
  const counts = data?.counts || {};

  return (
    <div ref={pageRef} className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_300px_at_50%_-80px,rgba(99,102,241,0.1),transparent_70%)]" />

      <div className="relative z-10 flex h-full flex-col overflow-y-auto p-6 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-[#1f1f2e]">Data Sync</h1>
            <p className="mt-0.5 text-sm text-[#9ca3af]">
              Sprintboard + ATS + Attendance → Manager Hub · auto-sync every 15 min
            </p>
          </div>
          <button
            onClick={loadStatus}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-[#EDEDF5] bg-white px-3.5 py-2 text-sm font-medium text-[#6b7280] hover:border-[#6c4dff]/30 hover:text-[#6c4dff] disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {/* Manual sync (admin only) */}
        {isAdmin && (
          <div className="mb-6 rounded-2xl border border-[#EDEDF5] bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={18} className="text-[#6c4dff]" />
              <h3 className="font-semibold text-[#1f1f2e]">Manual Sync</h3>
              <span className="rounded-full bg-[#f3f0ff] px-2 py-0.5 text-[10px] font-medium text-[#6c4dff]">Admin</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl border border-[#EDEDF5] overflow-hidden">
                {['all', 'sprintboard', 'ats', 'attendance'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSyncSource(s)}
                    className={`px-3.5 py-2 text-sm font-medium transition capitalize ${
                      syncSource === s
                        ? 'bg-[#6c4dff] text-white'
                        : 'bg-white text-[#6b7280] hover:bg-[#f7f7fb]'
                    }`}
                  >
                    {s === 'all' ? 'All Sources' : s}
                  </button>
                ))}
              </div>
              <button
                onClick={runSync}
                disabled={syncing}
                className="flex items-center gap-2 rounded-xl bg-[#6c4dff] px-5 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(108,77,255,0.3)] transition hover:bg-[#5b3df5] disabled:opacity-60"
              >
                <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing…' : 'Run Sync Now'}
              </button>
            </div>

            {syncResult && (
              <div className="mt-4 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-1">
                  <CheckCircle2 size={15} /> Sync completed
                </div>
                <div className="flex flex-wrap gap-2">
                  {syncResult.results?.map((r, i) => (
                    <div key={i} className="text-xs text-green-600">
                      <span className="font-medium capitalize">{r.source}</span>: {r.status}
                      {r.stats && Object.entries(r.stats).map(([k, v]) => (
                        <span key={k} className="ml-2 text-green-500">{k}={String(v)}</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!isAdmin && (
          <div className="mb-6 rounded-2xl border border-[#EDEDF5] bg-[#fafafa] p-4 flex items-center gap-3 text-sm text-[#9ca3af]">
            <Info size={16} className="shrink-0" />
            Manual sync requires Admin role. Data auto-syncs every 15 minutes.
          </div>
        )}

        {/* Record counts */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-[#1f1f2e] mb-3">Database Records</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(counts).map(([k, v]) => (
              <div key={k} className="sync-count-card">
                <CountCard name={k} count={v} />
              </div>
            ))}
          </div>
        </div>

        {/* Sync history */}
        <div>
          <h3 className="text-sm font-semibold text-[#1f1f2e] mb-3">Recent Sync Runs</h3>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-7 w-7 rounded-full border-2 border-[#6c4dff] border-t-transparent animate-spin" />
            </div>
          ) : !data?.runs?.length ? (
            <div className="rounded-2xl border border-dashed border-[#EDEDF5] py-10 text-center text-sm text-[#9ca3af]">
              No sync runs yet. {isAdmin ? 'Click "Run Sync Now" to start.' : 'Waiting for first sync.'}
            </div>
          ) : (
            <div className="space-y-3">
              {data.runs.map((run) => (
                <div key={run.id} className="sync-run-row">
                  <RunRow run={run} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
