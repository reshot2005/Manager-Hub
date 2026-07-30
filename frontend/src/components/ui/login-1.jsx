import { useState } from 'react';
import { Mail, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

function AppInput({ label, placeholder, icon, className, ...rest }) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  return (
    <div className="relative w-full min-w-[200px]">
      {label ? <label className="mb-2 block text-sm text-[var(--color-text-primary)]">{label}</label> : null}
      <div className="relative w-full">
        <input
          className={cn(
            'peer relative z-10 h-[3.25rem] w-full rounded-md border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 font-thin text-[var(--color-heading)] outline-none drop-shadow-sm transition-all duration-200 ease-in-out placeholder:font-medium placeholder:text-[var(--color-text-secondary)] focus:bg-[var(--color-bg)]',
            icon && 'pr-11',
            className
          )}
          placeholder={placeholder}
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          {...rest}
        />
        {isHovering ? (
          <>
            <div
              className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-[2px] overflow-hidden rounded-t-md"
              style={{
                background: `radial-gradient(30px circle at ${mousePosition.x}px 0px, var(--color-accent) 0%, transparent 70%)`,
              }}
            />
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[2px] overflow-hidden rounded-b-md"
              style={{
                background: `radial-gradient(30px circle at ${mousePosition.x}px 2px, var(--color-accent) 0%, transparent 70%)`,
              }}
            />
          </>
        ) : null}
        {icon ? (
          <div className="absolute right-3 top-1/2 z-20 -translate-y-1/2 text-[var(--color-text-secondary)]">
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Split-panel dark login shell (Vite-adapted from login-1).
 * Wired to Manager Hub auth via props — no Next.js dependency.
 */
export default function LoginOne({
  email = '',
  password = '',
  onEmailChange,
  onPasswordChange,
  onSubmit,
  busy = false,
  error = '',
}) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  function handleMouseMove(e) {
    const leftSection = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: e.clientX - leftSection.left,
      y: e.clientY - leftSection.top,
    });
  }

  const socialIcons = [
    {
      key: 'ig',
      label: 'Instagram',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3"
          />
        </svg>
      ),
    },
    {
      key: 'li',
      label: 'LinkedIn',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M6.94 5a2 2 0 1 1-4-.002a2 2 0 0 1 4 .002M7 8.48H3V21h4zm6.32 0H9.34V21h3.94v-6.57c0-3.66 4.77-4 4.77 0V21H22v-7.93c0-6.17-7.06-5.94-8.72-2.91z"
          />
        </svg>
      ),
    },
    {
      key: 'fb',
      label: 'Facebook',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="currentColor"
            d="M9.198 21.5h4v-8.01h3.604l.396-3.98h-4V7.5a1 1 0 0 1 1-1h3v-4h-3a5 5 0 0 0-5 5v2.01h-2l-.396 3.98h2.396z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="login-1-theme flex h-screen w-full items-center justify-center bg-[var(--color-bg)] p-4 text-[var(--color-text-primary)]">
      <div className="card flex h-[min(600px,92vh)] w-full max-w-5xl justify-between overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:w-[80%] md:w-[90%]">
        <div
          className="relative h-full w-full overflow-hidden px-4 lg:w-1/2 lg:px-14"
          onMouseMove={handleMouseMove}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <div
            className={`pointer-events-none absolute h-[500px] w-[500px] rounded-full bg-gradient-to-r from-teal-400/25 via-cyan-300/20 to-emerald-300/25 blur-3xl transition-opacity duration-200 ${
              isHovering ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              transform: `translate(${mousePosition.x - 250}px, ${mousePosition.y - 250}px)`,
              transition: 'transform 0.1s ease-out, opacity 0.2s ease',
            }}
          />

          <form
            className="relative z-10 grid h-full gap-2 py-8 text-center md:py-14"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit?.(e);
            }}
          >
            <div className="mb-2 grid gap-4 md:gap-5">
              <div className="flex flex-col items-center gap-2">
                <img
                  src="/ai-orb.png"
                  alt=""
                  className="h-12 w-12 rounded-full object-cover shadow-[0_0_24px_rgba(15,118,110,0.45)]"
                />
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--color-accent)]">
                  Manager AI Hub
                </p>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-[var(--color-heading)] md:text-4xl">
                Sign in
              </h1>

              <div className="flex items-center justify-center">
                <ul className="flex gap-3 md:gap-4">
                  {socialIcons.map((social) => (
                    <li key={social.key} className="list-none">
                      <button
                        type="button"
                        title={`${social.label} (coming soon)`}
                        className="group relative z-[1] flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-[3px] border-[var(--color-text-primary)] bg-[var(--color-bg-2)] md:h-12 md:w-12"
                      >
                        <div className="absolute inset-0 h-full w-full origin-bottom scale-y-0 bg-[var(--color-bg)] transition-transform duration-500 ease-in-out group-hover:scale-y-100" />
                        <span className="z-[2] text-[hsl(203,92%,8%)] transition-all duration-500 ease-in-out group-hover:rotate-[360deg] group-hover:text-[var(--color-accent)]">
                          {social.icon}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <span className="text-sm text-[var(--color-text-secondary)]">or use your account</span>
            </div>

            <div className="grid items-center gap-4">
              <AppInput
                placeholder="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => onEmailChange?.(e.target.value)}
                icon={<Mail size={16} strokeWidth={1.75} />}
              />
              <AppInput
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => onPasswordChange?.(e.target.value)}
                icon={<Lock size={16} strokeWidth={1.75} />}
              />
            </div>

            {error ? (
              <p className="mt-1 text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : (
              <p className="mt-1 text-sm font-light text-[var(--color-text-secondary)]">
                Use your manager credentials to continue
              </p>
            )}

            <div className="mt-2 flex items-center justify-center gap-4">
              <button
                type="submit"
                disabled={busy}
                className="group/button relative inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-normal text-white transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-lg hover:shadow-teal-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="px-2 py-1 text-sm font-semibold">
                  {busy ? 'Signing in…' : 'Sign In'}
                </span>
                <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-13deg)_translateX(-100%)] group-hover/button:duration-1000 group-hover/button:[transform:skew(-13deg)_translateX(100%)]">
                  <div className="relative h-full w-8 bg-white/20" />
                </div>
              </button>
            </div>
          </form>
        </div>

        <div className="relative hidden h-full w-1/2 overflow-hidden lg:block">
          <img
            src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1400&q=80"
            alt="Team collaborating"
            className="h-full w-full object-cover opacity-40 transition-transform duration-500 hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#101214] via-[#101214]/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-8">
            <p className="text-lg font-semibold text-[var(--color-heading)]">
              Real-time co-pilot for your team
            </p>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-text-primary)]">
              Attendance, EODs, tasks, and hiring — one premium workspace for managers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
