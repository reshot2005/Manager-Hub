import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useRef, useState, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import {
  Home,
  BarChart2,
  Users,
  FileText,
  CheckSquare,
  UserRoundSearch,
  Calendar,
  Activity,
  Settings,
  LogOut,
  X,
  Fingerprint,
  CalendarOff,
  Bell,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Dock, DockIcon, DockItem, DockLabel } from '@/components/ui/dock';

gsap.registerPlugin(useGSAP);

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'AI Chat', end: true, color: '#0F766E' },
  { to: '/dashboard', icon: BarChart2, label: 'Dashboard', color: '#0D9488' },
  { to: '/employees', icon: Users, label: 'Employees', color: '#14B8A6' },
  { to: '/attendance', icon: Fingerprint, label: 'Attendance', color: '#0F766E' },
  { to: '/leave', icon: CalendarOff, label: 'Leave', color: '#7C3AED' },
  { to: '/eod', icon: FileText, label: 'EOD Reports', color: '#0D9488' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks', color: '#115E59' },
  { to: '/candidates', icon: UserRoundSearch, label: 'Candidates', color: '#14B8A6' },
  { to: '/interviews', icon: Calendar, label: 'Interviews', color: '#0F766E' },
  { to: '/sync', icon: Activity, label: 'Data Sync', color: '#334155' },
];

function MagneticAvatar({ initials, name, onClick }) {
  const ref = useRef(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 180, damping: 14, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 180, damping: 14, mass: 0.4 });
  const springRotate = useSpring(rotate, { stiffness: 200, damping: 16 });

  function onMove(e) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    x.set(dx * 0.32);
    y.set(dy * 0.32);
    rotate.set(dx * 0.08);
  }

  function onLeave() {
    x.set(0);
    y.set(0);
    rotate.set(0);
  }

  return (
    <motion.button
      ref={ref}
      type="button"
      title={name}
      onClick={onClick}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ x: springX, y: springY, rotate: springRotate }}
      className="group relative flex h-11 w-11 items-center justify-center"
      whileTap={{ scale: 0.94 }}
    >
      <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[#0F766E] via-[#14B8A6] to-[#CA8A04] opacity-80 blur-[10px] transition group-hover:opacity-100" />
      <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#115E59] via-[#0F766E] to-[#134E4A] text-[12px] font-bold tracking-wide text-white shadow-[0_8px_24px_rgba(15,118,110,0.45)] ring-2 ring-white/80">
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_55%)]" />
        <span className="relative">{initials}</span>
      </span>
    </motion.button>
  );
}

export default function AppLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api('/alerts')
      .then((res) => {
        if (!cancelled) setAlerts(res.alerts || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  async function ackAlert(id) {
    try {
      await api(`/alerts/${id}/ack`, { method: 'POST' });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#F7F8FA]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0F766E] border-t-transparent" />
          <span className="text-sm text-[#9ca3af]">Loading workspace…</span>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const initials = (user.name || 'M')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isActive = (to, end) =>
    end ? location.pathname === to : location.pathname.startsWith(to);

  return (
    <div className="relative h-screen overflow-hidden bg-[#F7F8FA]">
      {/* Transparent floating dock overlay */}
      <aside className="pointer-events-none absolute inset-y-0 left-0 z-40 flex w-[76px] flex-col items-center justify-between overflow-visible bg-transparent py-5">
        <button
          type="button"
          title="Manager Hub"
          onClick={() => navigate('/')}
          className="pointer-events-auto mb-1 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0F766E] to-[#134E4A] text-[12px] font-black text-white shadow-[0_6px_20px_rgba(15,118,110,0.4)]"
        >
          MH
        </button>

        <div className="pointer-events-auto flex min-h-0 flex-1 items-center overflow-visible py-2">
          <Dock
            orientation="vertical"
            panelWidth={52}
            magnification={48}
            distance={100}
            className="!gap-2 !bg-transparent !px-1 !py-1 !shadow-none !ring-0"
          >
            {NAV_ITEMS.map(({ to, icon: Icon, label, end, color }) => {
              const active = isActive(to, end);
              return (
                <DockItem
                  key={to}
                  active={active}
                  onClick={() => navigate(to)}
                  style={
                    active
                      ? { background: `${color}24` }
                      : { background: 'rgba(255,255,255,0.55)' }
                  }
                >
                  <DockLabel>{label}</DockLabel>
                  <DockIcon>
                    <Icon
                      className="h-full w-full"
                      strokeWidth={active ? 2.1 : 1.7}
                      style={{ color: active ? color : '#64748b' }}
                    />
                  </DockIcon>
                </DockItem>
              );
            })}
          </Dock>
        </div>

        <div className="pointer-events-auto flex flex-col items-center gap-3 pt-2">
          <button
            type="button"
            title="Alerts"
            onClick={() => setAlertsOpen(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/60 text-[#94a3b8] backdrop-blur-sm transition hover:bg-white hover:text-[#0F766E]"
          >
            <Bell size={16} strokeWidth={1.85} />
            {alerts.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {alerts.length > 9 ? '9+' : alerts.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/60 text-[#94a3b8] backdrop-blur-sm transition hover:bg-white hover:text-[#0F766E]"
          >
            <Settings size={16} strokeWidth={1.85} />
          </button>
          <MagneticAvatar
            initials={initials}
            name={user.name}
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </aside>

      <main className="h-full min-h-0 w-full overflow-hidden pl-[72px]">
        <Outlet />
      </main>

      {settingsOpen && (
        <SettingsModal user={user} onClose={() => setSettingsOpen(false)} onLogout={logout} />
      )}
      {alertsOpen && (
        <AlertsPanel
          alerts={alerts}
          onAck={ackAlert}
          onClose={() => setAlertsOpen(false)}
        />
      )}
    </div>
  );
}

function AlertsPanel({ alerts, onAck, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1F2023]">Alerts</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-[#F0FDFA]">
            <X size={18} />
          </button>
        </div>
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-500">No unacknowledged alerts.</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <p className="font-semibold text-slate-800">
                  {a.severity} · {a.alert_type}
                </p>
                <p className="mt-1 text-slate-600">{a.message}</p>
                <button
                  type="button"
                  onClick={() => onAck(a.id)}
                  className="mt-2 text-xs font-medium text-teal-800 hover:underline"
                >
                  Acknowledge
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SettingsModal({ user, onClose, onLogout }) {
  const modalRef = useRef(null);

  useGSAP(
    () => {
      gsap.from(modalRef.current, {
        opacity: 0,
        scale: 0.95,
        y: 20,
        duration: 0.25,
        ease: 'power2.out',
      });
    },
    { scope: modalRef }
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1F2023]">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-[#F0FDFA]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-5 flex items-center gap-4 rounded-xl bg-[#F0FDFA] p-4">
          <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#115E59] via-[#0F766E] to-[#134E4A] text-sm font-bold text-white shadow-[0_6px_16px_rgba(15,118,110,0.35)]">
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.35),transparent_55%)]" />
            <span className="relative">
              {(user.name || 'M')
                .split(' ')
                .map((p) => p[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
          </div>
          <div>
            <div className="font-semibold text-[#1F2023]">{user.name}</div>
            <div className="text-sm text-[#9ca3af]">{user.email}</div>
            <div className="mt-0.5 inline-block rounded-full bg-[#0F766E]/10 px-2 py-0.5 text-[11px] font-medium text-[#0F766E]">
              {user.role || 'MANAGER'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-xl border border-[#E5E7EB] p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-[#9ca3af]">Version</div>
            <div className="text-sm font-medium text-[#1F2023]">Manager Hub v1.0</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            onLogout();
            onClose();
          }}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
