import { NavLink, Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
  ChevronRight,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

function LogoMark() {
  return (
    <div className="relative h-9 w-9 flex items-center justify-center">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] shadow-[0_4px_16px_rgba(108,77,255,0.5)]" />
      <span className="relative text-white font-black text-sm tracking-tight">MH</span>
    </div>
  );
}

export default function AppLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sidebarRef = useRef(null);
  const labelRefs = useRef([]);

  useGSAP(() => {
    if (expanded) {
      gsap.to(sidebarRef.current, { width: 220, duration: 0.3, ease: 'power2.out' });
      gsap.to('.nav-label', { opacity: 1, x: 0, duration: 0.25, stagger: 0.03, ease: 'power2.out', delay: 0.1 });
      gsap.to('.sidebar-logo-text', { opacity: 1, x: 0, duration: 0.2, ease: 'power2.out', delay: 0.05 });
    } else {
      gsap.to(sidebarRef.current, { width: 72, duration: 0.25, ease: 'power2.in' });
      gsap.to('.nav-label', { opacity: 0, x: -8, duration: 0.15, stagger: 0.02, ease: 'power2.in' });
      gsap.to('.sidebar-logo-text', { opacity: 0, x: -8, duration: 0.15, ease: 'power2.in' });
    }
  }, { scope: sidebarRef, dependencies: [expanded] });

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f7fb]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-[#6c4dff] border-t-transparent animate-spin" />
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

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f7fb]">
      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        style={{ width: 72 }}
        className="relative z-30 flex shrink-0 flex-col border-r border-[#EDEDF5] bg-white py-4 overflow-hidden"
      >
        {/* Logo row */}
        <div
          className="mb-5 flex items-center gap-3 px-4 cursor-pointer"
          onClick={() => setExpanded((v) => !v)}
        >
          <LogoMark />
          <span className="sidebar-logo-text whitespace-nowrap text-sm font-bold text-[#1f1f2e] opacity-0 translate-x-[-8px]">
            Manager Hub
          </span>
        </div>

        {/* Main nav */}
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label, end, color }) => {
            const isActive = end
              ? location.pathname === to
              : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-all duration-150"
                style={{
                  background: isActive ? `${color}18` : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = `${color}10`;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2.2 : 1.75}
                  style={{ color: isActive ? color : '#9ca3af', flexShrink: 0 }}
                />
                <span
                  className="nav-label whitespace-nowrap text-[13px] font-medium opacity-0 translate-x-[-8px]"
                  style={{ color: isActive ? color : '#6b7280' }}
                >
                  {label}
                </span>
                {isActive && (
                  <div
                    className="ml-auto h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col gap-1 px-2 pt-2 border-t border-[#EDEDF5] mt-2">
          <button
            type="button"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[#9ca3af] transition hover:bg-[#f3f0ff] hover:text-[#6c4dff]"
          >
            <Settings size={20} strokeWidth={1.75} style={{ flexShrink: 0 }} />
            <span className="nav-label whitespace-nowrap text-[13px] font-medium opacity-0 translate-x-[-8px]">
              Settings
            </span>
          </button>

          <button
            type="button"
            title={user.name}
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[#f3f0ff]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-xs font-bold text-white ring-2 ring-[#e9e4ff]">
              {initials}
            </div>
            <div className="nav-label flex-1 min-w-0 text-left opacity-0 translate-x-[-8px]">
              <div className="truncate text-[13px] font-semibold text-[#1f1f2e]">{user.name}</div>
              <div className="truncate text-[11px] text-[#9ca3af]">{user.role || 'Manager'}</div>
            </div>
            <ChevronRight
              size={14}
              className="nav-label shrink-0 text-[#9ca3af] opacity-0 translate-x-[-8px]"
            />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal user={user} onClose={() => setSettingsOpen(false)} onLogout={logout} />
      )}
    </div>
  );
}

function SettingsModal({ user, onClose, onLogout }) {
  const modalRef = useRef(null);

  useGSAP(() => {
    gsap.from(modalRef.current, {
      opacity: 0,
      scale: 0.95,
      y: 20,
      duration: 0.25,
      ease: 'power2.out',
    });
  }, { scope: modalRef });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-sm rounded-2xl border border-[#EDEDF5] bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-[#1f1f2e]">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-[#f3f0ff] text-[#9ca3af]">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-4 rounded-xl bg-[#f7f7fb] p-4 mb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#6c4dff] to-[#4f46e5] text-sm font-bold text-white">
            {(user.name || 'M').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
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
            <div className="text-[11px] text-[#9ca3af] uppercase tracking-wide mb-1">Version</div>
            <div className="text-sm font-medium text-[#1f1f2e]">Manager Hub v1.0</div>
          </div>
        </div>

        <button
          onClick={() => { onLogout(); onClose(); }}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
