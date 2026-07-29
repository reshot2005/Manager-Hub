/**
 * Deterministic hub answers when Gemini is slow/down.
 * Keeps Manager AI useful for the most common attendance questions.
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
      const reply =
        `## Quick take\n` +
        `Team pulse for **${data?.date || todayIst}** (IST).\n\n` +
        `## Attendance\n` +
        `- Present **${present}** · Late **${late}** · Absent **${absent}**\n` +
        `- Absentees: ${listNames(absentees)}\n` +
        `- Late arrivals: ${listNames(lateList)}\n\n` +
        `## Work & hiring\n` +
        `- Missing EODs: ${listNames(data?.missing_eods || data?.missingEods || [])}\n` +
        `- Overdue tasks: **${data?.overdue_count ?? data?.overdueTasks?.length ?? 0}**\n` +
        `- Interviews today: **${data?.interview_count ?? data?.interviews?.length ?? 0}**\n\n` +
        `## What you can do next\n` +
        `- Ask me to zoom into any name above\n` +
        `- Ask “who was absent yesterday?” for yesterday’s roll-call`;
      return { handled: true, reply, toolsUsed };
    }

    if (asksAbsent && asksYesterday) {
      const data = await executeTool('getAbsentees', { date: yesterdayIst }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `## Quick take\n` +
            `Nobody was marked **Absent** on **${yesterdayIst}** (IST) in the hub.\n\n` +
            `## Details\n` +
            `I checked attendance days for yesterday. If that feels incomplete, sync may still be catching up.\n\n` +
            `## What you can do next\n` +
            `- Ask for **today’s** present / late / absent\n` +
            `- Open **Data Sync** and run Attendance sync`
          : `## Quick take\n` +
            `**${rows.length}** people were absent on **${yesterdayIst}** (IST).\n\n` +
            `## Absentees\n` +
            rows.map((r) => `- **${r.name}**${r.email ? ` · ${r.email}` : ''}`).join('\n') +
            `\n\n## What you can do next\n` +
            `- Ask for today’s attendance roll-call\n` +
            `- Ask for full status on any name above`;
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent && !asksYesterday) {
      const date = asksToday ? todayIst : todayIst;
      const data = await executeTool('getAbsentees', { date }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `## Quick take\n` +
            `No absentees on **${date}** (IST).\n\n` +
            `## Details\n` +
            `Everyone looks present or not marked Absent in the hub for this date.\n\n` +
            `## What you can do next\n` +
            `- Ask for late arrivals vs shift\n` +
            `- Ask for yesterday’s absentees`
          : `## Quick take\n` +
            `**${rows.length}** absent on **${date}** (IST).\n\n` +
            `## Absentees\n` +
            rows.map((r) => `- **${r.name}**`).join('\n') +
            `\n\n## What you can do next\n` +
            `- Ask for late arrivals vs each person’s shift\n` +
            `- Ask for a full status on any name`;
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (/\bpresent\b/.test(q) || /\blate\b/.test(q) || /\battendance\b/.test(q) || /\broll\b/.test(q)) {
      const data = await executeTool('getAttendanceToday', {}, manager);
      const present = data?.present || [];
      const late = data?.late || [];
      const absent = data?.absent || [];
      const reply =
        `## Quick take\n` +
        `Attendance for **${data?.date || todayIst}** (IST).\n\n` +
        `## Headcount\n` +
        `- **Present (${present.length}):** ${listNames(present)}\n` +
        `- **Late (${late.length}):** ${listNames(late)}\n` +
        `- **Absent (${absent.length}):** ${listNames(absent)}\n\n` +
        `## What you can do next\n` +
        `- Ask me to break down late minutes vs each person’s shift\n` +
        `- Ask for absentees yesterday`;
      return { handled: true, reply, toolsUsed: ['getAttendanceToday'] };
    }
  } catch (err) {
    console.warn('[hubFastAnswer]', err.message?.slice(0, 160));
    return { handled: false };
  }

  return { handled: false };
}
