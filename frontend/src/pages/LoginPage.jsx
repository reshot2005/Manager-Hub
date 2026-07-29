import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-canvas px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_360px_at_50%_-40px,rgba(167,139,250,0.28),transparent_70%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-5">
            <div className="absolute inset-0 scale-125 rounded-full bg-brand/25 blur-2xl" />
            <img src="/ai-orb.png" alt="" className="relative h-20 w-20 rounded-full object-cover" />
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-brand-ink">Manager AI Hub</h1>
          <p className="mt-2 text-sm text-mute">Sign in to track employees, EODs, and candidates.</p>
        </div>

        <form onSubmit={onSubmit} className="prompt-card space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-mute">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-edge bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-mute">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-edge bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(108,77,255,0.35)] transition hover:bg-brand-deep disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
