/**
 * Asia/Kolkata calendar helpers for Hub AI relative dates.
 * Never pass "yesterday"/"today"/"tomorrow" into SQL — resolve here first.
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Add calendar days to an IST YYYY-MM-DD string (noon IST avoids DST edge cases). */
export function addIstDays(ymd, deltaDays) {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return formatYmd(d);
}

/** Live IST calendar anchors. */
export function getIstCalendar(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    today,
    yesterday: addIstDays(today, -1),
    tomorrow: addIstDays(today, 1),
    nowLabel: `${today} ${parts.hour}:${parts.minute}:${parts.second} IST`,
    timezone: 'Asia/Kolkata',
  };
}

function levenshtein(a, b) {
  const s = String(a);
  const t = String(b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

const DAY_ALIASES = {
  yesterday: [
    'yesterday',
    'yesteraday',
    'yesturday',
    'yestrday',
    'yeserday',
    'yesteday',
    'yesteray',
    'yasterday',
  ],
  today: ['today', 'todays', 'todya', 'todqy', 'tday'],
  tomorrow: [
    'tomorrow',
    'tommorow',
    'tommorrow',
    'tomorow',
    'tommorro',
    'tmrw',
    'tmr',
    'tomo',
  ],
};

/**
 * Detect relative day word in free text (typo-tolerant).
 * @returns {'yesterday'|'today'|'tomorrow'|null}
 */
export function detectRelativeDayInText(text) {
  const q = String(text || '').toLowerCase();
  if (!q.trim()) return null;

  if (/\blast\s+day\b/.test(q) || /\bprevious\s+day\b/.test(q) || /\bday\s+before\b/.test(q)) {
    return 'yesterday';
  }
  if (/\bnext\s+day\b/.test(q)) return 'tomorrow';

  // Prefer longer / more specific matches first when scanning tokens
  const tokens = q.match(/[a-z]+/g) || [];
  let best = null;
  let bestDist = Infinity;

  for (const token of tokens) {
    for (const [day, aliases] of Object.entries(DAY_ALIASES)) {
      for (const alias of aliases) {
        if (token === alias) {
          // Exact alias — return immediately with priority: yesterday > tomorrow > today
          // (callers often omit "today"; exact yesterday/tomorrow must win)
          if (day === 'yesterday' || day === 'tomorrow') return day;
          if (!best) best = day;
          continue;
        }
        const maxLen = Math.max(token.length, alias.length);
        if (maxLen < 4) continue;
        const dist = levenshtein(token, alias);
        const allowed = maxLen <= 5 ? 1 : 2;
        if (dist <= allowed && dist < bestDist) {
          bestDist = dist;
          best = day;
        }
      }
    }
  }
  return best;
}

/**
 * Resolve a tool date argument or free-text relative day to YYYY-MM-DD IST.
 * Accepts: YYYY-MM-DD | yesterday/today/tomorrow (and common typos) | null → today.
 */
export function resolveRelativeIstDate(input, calendar = getIstCalendar()) {
  if (input == null || String(input).trim() === '') return calendar.today;

  const raw = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const lower = raw.toLowerCase();
  if (lower === 'yesterday' || DAY_ALIASES.yesterday.includes(lower)) return calendar.yesterday;
  if (lower === 'today' || DAY_ALIASES.today.includes(lower)) return calendar.today;
  if (lower === 'tomorrow' || DAY_ALIASES.tomorrow.includes(lower)) return calendar.tomorrow;

  const detected = detectRelativeDayInText(raw);
  if (detected === 'yesterday') return calendar.yesterday;
  if (detected === 'tomorrow') return calendar.tomorrow;
  if (detected === 'today') return calendar.today;

  // Fuzzy single-token against canonical words
  const token = lower.replace(/[^a-z]/g, '');
  if (token) {
    for (const [day, aliases] of Object.entries(DAY_ALIASES)) {
      for (const alias of aliases) {
        const maxLen = Math.max(token.length, alias.length);
        if (maxLen >= 4 && levenshtein(token, alias) <= (maxLen <= 5 ? 1 : 2)) {
          return calendar[day];
        }
      }
    }
  }

  return null; // unresolvable — caller should not invent
}

/**
 * From a manager message, pick the IST date they mean for a single-day query.
 * Default: today when no relative day is mentioned.
 */
export function dateFromManagerMessage(message, calendar = getIstCalendar()) {
  const day = detectRelativeDayInText(message);
  if (day === 'yesterday') return { date: calendar.yesterday, relative: 'yesterday' };
  if (day === 'tomorrow') return { date: calendar.tomorrow, relative: 'tomorrow' };
  if (day === 'today') return { date: calendar.today, relative: 'today' };
  return { date: calendar.today, relative: 'today' };
}
