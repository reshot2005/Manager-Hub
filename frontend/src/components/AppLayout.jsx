import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Dock, DockIcon, DockItem, DockLabel } from '@/components/ui/dock';

gsap.registerPlugin(useGSAP);

const NAV_ITEMS = [
  { to: '/', icon: Home, label: 'AI Chat', end: true, color: '#6c4dff' },
  { to: '/dashboard', icon: BarChart2, label: 'Dashboard', color: '#0ea5e9' },
  { to: '/employees', icon: Users, label: 'Employees', color: '#10b981' },
  { to: '/attendance', icon: Fingerprint, label: 'Attendance', color: '#059669' },
  { to: '/eod', icon: FileText, label: 'EOD Reports', color: '#f59e0b' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks', color: '#ef4444' },
  { to: '/candidates', icon: UserRoundSearch, label: 'Candidates', color: '#8b5cf6' },
  { to: '/interviews', icon: Calendar, label: 'Interviews', color: '#06b6d4' },
  { to: '/sync', icon: Activity, label: 'Data Sync', color: '#6366f1' },
];

export default function AppLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f7fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#6c4dff] border-t-transparent" />
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
    <div className="relative flex h-screen overflow-hidden bg-[#f7f7fb]">
      {/* Vertical Apple-style dock — left rail */}
      <aside className="relative z-30 flex h-full w-[88px] shrink-0 flex-col items-center justify-between border-r border-[#EDEDF5]/80 bg-gradient-to-b from-white via-[#faf9ff] to-white py-4">
        <button
          type="button"
          title="Manager Hub"
          onClick={() => navigate('/')}
          className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-sm font-black text-white shadow-[0_4px_16px_rgba(108,77,255,0.45)]"
        >
          MH
        </button>

        <div className="flex min-h-0 flex-1 items-center py-2">
          <Dock
            orientation="vertical"
            panelWidth={64}
            magnification={70}
            distance={120}
            className="!bg-transparent !shadow-none !ring-0 !px-1 !py-2"
          >
            {NAV_ITEMS.map(({ to, icon: Icon, label, end, color }) => {
              const active = isActive(to, end);
              return (
                <DockItem
                  key={to}
                  active={active}
                  onClick={() => navigate(to)}
                  style={active ? { background: `${color}28` } : undefined}
                >
                  <DockLabel>{label}</DockLabel>
                  <DockIcon>
                    <Icon
                      className="h-full w-full"
                      strokeWidth={active ? 2.25 : 1.85}
                      style={{ color: active ? color : '#6b7280' }}
                    />
                  </DockIcon>
                </DockItem>
              );
            })}
          </Dock>
        </div>

        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-[#9ca3af] transition hover:bg-[#f3f0ff] hover:text-[#6c4dff]"
          >
            <Settings size={18} strokeWidth={1.85} />
          </button>
          <button
            type="button"
            title={user.name}
            onClick={() => setSettingsOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-[11px] font-bold text-white ring-2 ring-[#e9e4ff]"
          >
            {initials}
          </button>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      {settingsOpen && (
        <SettingsModal user={user} onClose={() => setSettingsOpen(false)} onLogout={logout} />
      )}
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
        className="w-full max-w-sm rounded-2xl border border-[#EDEDF5] bg-white p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1f1f2e]">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#9ca3af] hover:bg-[#f3f0ff]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-5 flex items-center gap-4 rounded-xl bg-[#f7f7fb] p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-sm font-bold text-white">
            {(user.name || 'M')
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-[#1f1f2e]">{user.name}</div>
            <div className="text-sm text-[#9ca3af]">{user.email}</div>
            <div className="mt-0.5 inline-block rounded-full bg-[#6c4dff]/10 px-2 py-0.5 text-[11px] font-medium text-[#6c4dff]">
              {user.role || 'MANAGER'}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-xl border border-[#EDEDF5] p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-[#9ca3af]">Version</div>
            <div className="text-sm font-medium text-[#1f1f2e]">Manager Hub v1.0</div>
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
