/**
 * Corporate shift profiles (IST).
 * Default for most interns/employees: 09:30 – 19:00
 * Also common: 10:30 – 20:00 and 08:00 – 18:00
 */

export const SHIFT_PROFILES = {
  STANDARD: {
    id: 'STANDARD',
    label: 'Standard (most interns & employees)',
    shift_start: '09:30',
    shift_end: '19:00',
    late_after: '09:30',
  },
  LATE_START: {
    id: 'LATE_START',
    label: 'Late start',
    shift_start: '10:30',
    shift_end: '20:00',
    late_after: '10:30',
  },
  EARLY: {
    id: 'EARLY',
    label: 'Early shift',
    shift_start: '08:00',
    shift_end: '18:00',
    late_after: '08:00',
  },
};

export const DEFAULT_SHIFT = SHIFT_PROFILES.STANDARD;

/** Parse "HH:MM" or "H:MM" → minutes from midnight */
export function timeToMinutes(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'number' && Number.isFinite(t)) return Math.max(0, Math.round(t));
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

export function minutesToTime(mins) {
  if (mins == null || Number.isNaN(mins)) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Instant → minutes from midnight in Asia/Kolkata */
export function minutesFromMidnightIst(dateLike) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

export function formatTimeIst(dateLike) {
  if (!dateLike) return null;
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Resolve shift from Attendance Tracker Candidate fields or known patterns.
 * Prefers explicit shiftStartTime / shiftEndTime / lateMaxTime from source.
 */
export function resolveShift({
  shift_start,
  shift_end,
  late_max_time,
  late_after,
} = {}) {
  let start = normalizeTime(shift_start);
  let end = normalizeTime(shift_end);
  let late = normalizeTime(late_after || late_max_time);

  // Match known corporate profiles when partial data given
  const startMin = timeToMinutes(start);
  if (startMin === timeToMinutes('10:30') || startMin === timeToMinutes('10:00')) {
    return {
      ...SHIFT_PROFILES.LATE_START,
      shift_start: start || SHIFT_PROFILES.LATE_START.shift_start,
      shift_end: end || SHIFT_PROFILES.LATE_START.shift_end,
      late_after: late || start || SHIFT_PROFILES.LATE_START.late_after,
    };
  }
  if (startMin === timeToMinutes('08:00') || startMin === timeToMinutes('08:30')) {
    return {
      ...SHIFT_PROFILES.EARLY,
      shift_start: start || SHIFT_PROFILES.EARLY.shift_start,
      shift_end: end || SHIFT_PROFILES.EARLY.shift_end,
      late_after: late || start || SHIFT_PROFILES.EARLY.late_after,
    };
  }

  return {
    ...DEFAULT_SHIFT,
    shift_start: start || DEFAULT_SHIFT.shift_start,
    shift_end: end || DEFAULT_SHIFT.shift_end,
    late_after: late || start || DEFAULT_SHIFT.late_after,
  };
}

function normalizeTime(t) {
  const mins = timeToMinutes(t);
  return mins == null ? null : minutesToTime(mins);
}

/**
 * Compute late minutes + status hint from first punch vs employee's late_after.
 * @returns {{ late_minutes: number, is_late: boolean, late_after: string, shift_start: string, shift_end: string }}
 */
export function evaluateLogin(firstIn, shift = DEFAULT_SHIFT) {
  const resolved = resolveShift(shift);
  const loginMin = minutesFromMidnightIst(firstIn);
  const lateAfterMin = timeToMinutes(resolved.late_after) ?? timeToMinutes(DEFAULT_SHIFT.late_after);
  if (loginMin == null || lateAfterMin == null) {
    return {
      late_minutes: 0,
      is_late: false,
      late_after: resolved.late_after,
      shift_start: resolved.shift_start,
      shift_end: resolved.shift_end,
      first_in_ist: formatTimeIst(firstIn),
    };
  }
  const late_minutes = Math.max(0, loginMin - lateAfterMin);
  return {
    late_minutes,
    is_late: late_minutes > 0,
    late_after: resolved.late_after,
    shift_start: resolved.shift_start,
    shift_end: resolved.shift_end,
    first_in_ist: formatTimeIst(firstIn),
  };
}

/** Human-readable shift line for AI tools */
export function shiftLabel(shift) {
  const s = resolveShift(shift || {});
  return `${s.shift_start}–${s.shift_end} IST (late after ${s.late_after})`;
}
