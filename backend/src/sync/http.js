/**
 * Thin HTTP client for source APIs (Sprintboard / ATS).
 */
export async function apiFetch(baseUrl, path, { method = 'GET', token, body, headers = {} } = {}) {
  const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || res.statusText;
    const err = new Error(`${method} ${url} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function loginSprintboard(baseUrl, email, password) {
  const data = await apiFetch(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const token = data.token || data.data?.token;
  if (!token) throw new Error('Sprintboard login: no token in response');
  return { token, user: data };
}

export async function loginAts(baseUrl, email, password) {
  const data = await apiFetch(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const token = data.data?.token || data.token;
  if (!token) throw new Error('ATS login: no token in response');
  return { token, user: data.data?.user || data.user };
}
