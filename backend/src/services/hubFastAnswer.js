/**
 * Deterministic hub answers when Gemini is slow/down.
 * Keeps Hub AI useful for the most common attendance questions — tools only, no invention.
 */
import { executeTool } from '../tools/index.js';

function nowInIstParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  const todayIst = `${parts.year}-${parts.month}-${parts.day}`;
  const d = new Date(`${todayIst}T12:00:00+05:30`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return { todayIst, yesterdayIst: `${y}-${m}-${day}` };
}

function listNames(rows, key = 'name') {
  if (!rows?.length) return 'none';
  return rows
    .map((r) => `**${r[key] || r.name}**`)
    .slice(0, 40)
    .join(', ');
}

function formatTimeIst(value) {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return String(value);
  }
}

function formatLateLine(r) {
  const name = r.name || 'Unknown';
  const firstIn = formatTimeIst(r.first_in);
  const lateMins = r.late_minutes != null ? Number(r.late_minutes) : null;
  const lateAfter = r.late_after || r.shift_start || '09:30';
  const parts = [`**${name}**`];
  if (firstIn) parts.push(`in ${firstIn}`);
  if (lateMins != null && !Number.isNaN(lateMins)) {
    parts.push(`${lateMins} min late (after ${lateAfter})`);
  } else if (firstIn) {
    parts.push(`after ${lateAfter}`);
  }
  return parts.join(' — ');
}

/**
 * @returns {{ handled: true, reply: string, toolsUsed: string[] } | { handled: false }}
 */
export async function tryHubFastAnswer(manager, userMessage) {
  const q = String(userMessage || '').toLowerCase();
  const { todayIst, yesterdayIst } = nowInIstParts();

  const asksAbsent =
    /\babsent/.test(q) ||
    /\bwho\b.*\bmissed\b/.test(q) ||
    /\bnot\s+present\b/.test(q);
  const asksYesterday = /\byesterday\b/.test(q) || /\blast\s+day\b/.test(q);
  const asksToday =
    /\btoday\b/.test(q) || (!asksYesterday && /\b(present|late|attendance|roll)\b/.test(q));
  const asksBrief =
    /\bbriefing\b/.test(q) ||
    /\bwho needs attention\b/.test(q) ||
    /\bstandup\b/.test(q) ||
    /\bteam pulse\b/.test(q);

  try {
    if (asksBrief) {
      const data = await executeTool('getDailyBriefing', {}, manager);
      const toolsUsed = ['getDailyBriefing'];
      const present = data?.present_count ?? data?.attendance?.present?.length ?? '?';
      const late = data?.late_count ?? data?.attendance?.late?.length ?? '?';
      const absent = data?.absent_count ?? data?.absentees?.length ?? data?.attendance?.absent?.length ?? '?';
      const absentees = data?.absentees || data?.attendance?.absent || [];
      const lateList = data?.late || data?.attendance?.late || [];
      const lateDetail =
        lateList.length > 0
          ? lateList
              .slice(0, 20)
              .map((r) => `- ${formatLateLine(r)}`)
              .join('\n')
          : '- none';
      const reply =
        `**${absent}** absent · **${late}** late · **${present}** present on **${data?.date || todayIst}** (IST).\n\n` +
        `**Absentees:** ${listNames(absentees)}\n` +
        `**Late:**\n${lateDetail}\n\n` +
        `Missing EODs: ${listNames(data?.missing_eods || data?.missingEods || [])}\n` +
        `Overdue tasks: **${data?.overdue_count ?? data?.overdueTasks?.length ?? 0}** · Interviews today: **${data?.interview_count ?? data?.interviews?.length ?? 0}**\n\n` +
        `Want names expanded or yesterday’s absentees?`;
      return { handled: true, reply, toolsUsed };
    }

    if (asksAbsent && asksYesterday) {
      const data = await executeTool('getAbsentees', { date: yesterdayIst }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** people marked **Absent** on **${yesterdayIst}** (IST).\n\n` +
            `If that feels incomplete, hub sync may still be catching up — that is not the same as inventing absentees.\n\n` +
            `Ask for today’s roll-call, or sync Attendance in Data Sync.`
          : `**${rows.length}** people were absent on **${yesterdayIst}** (IST):\n` +
            rows.map((r) => `- **${r.name}**${r.email ? ` · ${r.email}` : ''}`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent && !asksYesterday) {
      const date = asksToday ? todayIst : todayIst;
      const data = await executeTool('getAbsentees', { date }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** absentees on **${date}** (IST).\n\n` +
            `Ask for late arrivals (with check-in times), or yesterday’s absentees.`
          : `**${rows.length}** absent on **${date}** (IST):\n` +
            rows.map((r) => `- **${r.name}**`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (/\bpresent\b/.test(q) || /\blate\b/.test(q) || /\battendance\b/.test(q) || /\broll\b/.test(q)) {
      const data = await executeTool('getAttendanceToday', {}, manager);
      if (data?.note && !(data.present?.length || data.late?.length || data.absent?.length)) {
        return {
          handled: true,
          reply:
            `No attendance data synced for **${data?.date || todayIst}** (IST) yet.\n\n` +
            `That is not the same as everyone being absent — sync Attendance and ask again.`,
          toolsUsed: ['getAttendanceToday'],
        };
      }
      const present = data?.present || [];
      const late = data?.late || [];
      const absent = data?.absent || [];
      const lateLines =
        late.length > 0
          ? late.map((r) => `- ${formatLateLine(r)}`).join('\n')
          : '- none';
      const reply =
        `**${absent.length}** absent · **${late.length}** late · **${present.length}** present on **${data?.date || todayIst}** (IST).\n\n` +
        `**Late:**\n${lateLines}\n\n` +
        `**Absent:** ${listNames(absent)}\n\n` +
        `Want full present list or yesterday’s absentees?`;
      return { handled: true, reply, toolsUsed: ['getAttendanceToday'] };
    }
  } catch (err) {
    console.warn('[hubFastAnswer]', err.message?.slice(0, 160));
    return { handled: false };
  }

  return { handled: false };
}
