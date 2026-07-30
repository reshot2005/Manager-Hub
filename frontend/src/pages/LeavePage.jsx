import { useEffect, useState, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { CalendarOff, Plus, Check, X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

gsap.registerPlugin(useGSAP);

const LEAVE_TYPES = ['Sick', 'Casual', 'WFH', 'Other'];

export default function LeavePage() {
  const [leaves, setLeaves] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    employeeId: '',
    leaveType: 'Casual',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    notes: '',
    approve: true,
  });
  const [saving, setSaving] = useState(false);
  const pageRef = useRef(null);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([api('/leave'), api('/employees')])
      .then(([leaveRes, empRes]) => {
        setLeaves(leaveRes.leaves || []);
        setEmployees(empRes.employees || empRes || []);
      })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useGSAP(
    () => {
      if (!pageRef.current) return;
      gsap.from(pageRef.current.querySelectorAll('[data-anim]'), {
        opacity: 0,
        y: 12,
        duration: 0.4,
        stagger: 0.05,
        ease: 'power2.out',
      });
    },
    { dependencies: [loading, leaves.length], scope: pageRef }
  );

  async function submit(e) {
    e.preventDefault();
    if (!form.employeeId) return;
    setSaving(true);
    setError('');
    try {
      await api('/leave', {
        method: 'POST',
        body: {
          employeeId: form.employeeId,
          leaveType: form.leaveType,
          startDate: form.startDate,
          endDate: form.endDate,
          notes: form.notes || undefined,
          approve: form.approve,
        },
      });
      load();
    } catch (err) {
      setError(err.message || 'Failed to create leave');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/leave/${id}/status`, { method: 'PATCH', body: { status } });
      load();
    } catch (err) {
      setError(err.message || 'Failed to update');
    }
  }

  const empList = Array.isArray(employees) ? employees : [];

  return (
    <div ref={pageRef} className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
      <header data-anim className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Leave</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <CalendarOff className="h-6 w-6 text-teal-700" />
            Leave requests
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Approved leave marks attendance as On Leave (not Absent) for Hub AI and risk scores.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form
        data-anim
        onSubmit={submit}
        className="grid gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm md:grid-cols-2"
      >
        <h2 className="md:col-span-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Plus className="h-4 w-4" /> New leave
        </h2>
        <label className="text-sm text-slate-700">
          Employee
          <select
            required
            value={form.employeeId}
            onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            <option value="">Select…</option>
            {empList.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Type
          <select
            value={form.leaveType}
            onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Start
          <input
            type="date"
            required
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="text-sm text-slate-700">
          End
          <input
            type="date"
            required
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
          />
        </label>
        <label className="md:col-span-2 text-sm text-slate-700">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
            placeholder="Optional"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.approve}
            onChange={(e) => setForm((f) => ({ ...f, approve: e.target.checked }))}
          />
          Approve immediately
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Submit leave'}
          </button>
        </div>
      </form>

      <section data-anim className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">Recent requests</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : leaves.length === 0 ? (
          <p className="text-sm text-slate-500">No leave records yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {leaves.map((lr) => (
              <li key={lr.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {lr.employee_name}{' '}
                    <span className="font-normal text-slate-500">· {lr.leave_type}</span>
                  </p>
                  <p className="text-slate-600">
                    {String(lr.start_date).slice(0, 10)} → {String(lr.end_date).slice(0, 10)} ·{' '}
                    <span
                      className={
                        lr.status === 'Approved'
                          ? 'text-violet-700'
                          : lr.status === 'Rejected'
                            ? 'text-red-600'
                            : 'text-amber-700'
                      }
                    >
                      {lr.status}
                    </span>
                  </p>
                </div>
                {lr.status === 'Pending' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStatus(lr.id, 'Approved')}
                      className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 text-teal-800"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(lr.id, 'Rejected')}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-red-700"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
