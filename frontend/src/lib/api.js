const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' &&
  !['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? '/api'
    : 'http://localhost:4100/api');

function getToken() {
  return sessionStorage.getItem('hub_token') || localStorage.getItem('hub_token');
}

export function getStoredUser() {
  try {
    return JSON.parse(sessionStorage.getItem('hub_user') || localStorage.getItem('hub_user') || 'null');
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  // Prefer sessionStorage (cleared on browser close) — cookies are primary httpOnly auth
  sessionStorage.setItem('hub_token', token);
  sessionStorage.setItem('hub_user', JSON.stringify(user));
  localStorage.removeItem('hub_token');
  localStorage.removeItem('hub_user');
}

export function clearSession() {
  sessionStorage.removeItem('hub_token');
  sessionStorage.removeItem('hub_user');
  localStorage.removeItem('hub_token');
  localStorage.removeItem('hub_user');
}

async function parseResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // Silent refresh once on expired access token
  if (res.status === 401 && auth && path !== '/auth/login' && path !== '/auth/refresh') {
    try {
      const refreshed = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
      if (refreshed.ok) {
        const data = await refreshed.json();
        if (data.token && data.user) setSession(data.token, data.user);
        const retry = await fetch(`${API_BASE}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(data.token ? { Authorization: `Bearer ${data.token}` } : {}),
          },
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined,
        });
        return parseResponse(retry);
      }
    } catch {
      /* fall through */
    }
  }

  return parseResponse(res);
}
