/**
 * Deterministic hub answers when Gemini is slow/down/quota-limited.
 * Prefer tools-only for common ops — never invent data.
 */
import { executeTool } from '../tools/index.js';
import {
  dateFromManagerMessage,
  detectRelativeDayInText,
  getIstCalendar,
} from '../utils/istDates.js';

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

function extractEmployeeName(q) {
  const patterns = [
    /(?:status|profile|update)\s+(?:of|for|on)\s+([a-z][a-z.' -]{1,40})/i,
    /(?:tell me about|what about|how is|how's)\s+([a-z][a-z.' -]{1,40})/i,
    /(?:is|was)\s+([a-z][a-z.' -]{1,30})\s+(?:present|absent|late|here|working|done)/i,
    /(?:what is|what's)\s+([a-z][a-z.' -]{1,30})\s+working\s+on/i,
    /(?:eod|report)\s+(?:of|for|from)\s+([a-z][a-z.' -]{1,40})/i,
    /(?:tasks?|pending|overdue)\s+(?:for|of)\s+([a-z][a-z.' -]{1,40})/i,
    /^([a-z][a-z.'-]{1,30})\s+(?:status|today|attendance|eod|tasks?)\??$/i,
  ];
  const STOP = new Set([
    'who', 'what', 'when', 'where', 'how', 'show', 'list', 'get', 'my', 'our',
    'the', 'a', 'an', 'all', 'every', 'everyone', 'entire', 'whole', 'team',
    'staff', 'employee', 'employees', 'people', 'person', 'today', 'yesterday',
    'tomorrow', 'week', 'please', 'now', 'me', 'us', 'this', 'that', 'their', 'your',
  ]);
  for (const re of patterns) {
    const m = q.match(re);
    if (!m?.[1]) continue;
    let name = m[1]
      .replace(/\b(today|yesterday|tomorrow|please|now|team|the|whole|entire|all|everyone|my|our)\b/gi, '')
      .replace(/[?.!,]+$/g, '')
      .trim();
    if (name.length < 2) continue;
    const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.every((p) => STOP.has(p))) continue;
    if (STOP.has(name.toLowerCase())) continue;
    if (/^(who|what|when|where|how|show|list|get|my)$/i.test(name)) continue;
    return name;
  }
  return null;
}

/**
 * @returns {{ handled: true, reply: string, toolsUsed: string[] } | { handled: false }}
 */
export async function tryHubFastAnswer(manager, userMessage) {
  const q = String(userMessage || '').toLowerCase().trim();
  const cal = getIstCalendar();
  const todayIst = cal.today;
  const yesterdayIst = cal.yesterday;
  const tomorrowIst = cal.tomorrow;
  // Typo-tolerant: "yesteraday", "tommorow", "tmrw", etc.
  const relativeDay = detectRelativeDayInText(q);
  const dayPick = dateFromManagerMessage(userMessage, cal);
  const targetDay = dayPick.date;

  const asksAbsent =
    /\babsent/.test(q) ||
    /\bwho\b.*\bmissed\b/.test(q) ||
    /\bnot\s+present\b/.test(q);
  const asksYesterday = relativeDay === 'yesterday';
  const asksTomorrow = relativeDay === 'tomorrow';
  const asksThisWeek = /\bthis\s+week\b/.test(q) || /\bcurrent\s+week\b/.test(q);
  const asksLastWeek = /\blast\s+week\b/.test(q);
  const asksWeek = asksThisWeek || asksLastWeek || /\bweekly\b/.test(q);
  const asksCompare =
    /\bcompar/.test(q) ||
    /\bvs\.?\b/.test(q) ||
    /\bversus\b/.test(q) ||
    /\bagainst\b/.test(q) ||
    (asksThisWeek && asksLastWeek);
  const asksPct =
    /\bpercent/.test(q) ||
    /\bpercentage\b/.test(q) ||
    /\brate\b/.test(q) ||
    /%/.test(q);
  const asksBrief =
    /\bbriefing\b/.test(q) ||
    /\bwho needs attention\b/.test(q) ||
    /\bstandup\b/.test(q) ||
    /\bteam pulse\b/.test(q) ||
    /\bdaily\s+brief\b/.test(q);
  const asksInterviews =
    /\binterview/.test(q) || /\bhiring\b/.test(q) || /\bcandidate/.test(q);
  const asksTasks =
    /\boverdue\b/.test(q) ||
    /\bpending\s+tasks?\b/.test(q) ||
    /\bopen\s+tasks?\b/.test(q) ||
    /\btasks?\s+pending\b/.test(q);
  const asksEod =
    /\beod\b/.test(q) ||
    /\bdaily\s+report/.test(q) ||
    /\bmissing\s+eod/.test(q) ||
    /\bwho\b.*\bsubmit/.test(q);
  const asksTeamWide =
    /\b(all|every|everyone|entire|whole)\b/.test(q) ||
    /\b(for\s+)?(the\s+)?team\b/.test(q) ||
    /\bemployees?\b/.test(q);
  const asksTeamWork =
    /\bshow\s+all\s+employees?\b/.test(q) ||
    /\b(all|every|everyone|entire)\s+employees?\b/.test(q) ||
    /\bteam\s+work\b/.test(q) ||
    /\bwork\s+board\b/.test(q) ||
    (/\beod\b/.test(q) && asksTeamWide) ||
    (/\b(assigned|completed|completion)\b/.test(q) && /\b(open|overdue|eod|tasks?)\b/.test(q)) ||
    (/\btasks?\b/.test(q) &&
      /\b(assigned|completed|completion|open|done)\b/.test(q) &&
      asksTeamWide) ||
    /\bassigned\s+vs\s+completed\b/.test(q) ||
    /\btask\s+status\s+(for\s+)?(all|everyone|team|whole)\b/.test(q) ||
    (/\beod\b/.test(q) &&
      /\b(assigned|open|completed|overdue)\b/.test(q));
  const asksLogin =
    /\blogin\s+tim/.test(q) ||
    /\bcheck[- ]?in/.test(q) ||
    /\bfirst\s+punch/.test(q) ||
    /\bwho\s+came\s+after\b/.test(q);

  function formatPeriodBlock(p, title) {
    if (!p) return '';
    if (p.synced_rows === 0) {
      return (
        `**${title}** (${p.start_date} → ${p.end_date} IST):\n` +
        `No attendance rows synced in this range yet (not the same as 0% attendance).\n`
      );
    }
    return (
      `**${title}** (${p.start_date} → ${p.end_date} IST):\n` +
      `• Synced rows: **${p.synced_rows}** across **${p.synced_days}** day(s)\n` +
      `• Present **${p.present}** · Late **${p.late}** · Absent **${p.absent}** · On leave **${p.on_leave}** · Half day **${p.half_day}**\n` +
      `• Attendance %: **${p.attendance_pct}%** · Absent %: **${p.absent_pct}%**\n`
    );
  }

  try {
    // Week compare — never route to getAttendanceToday
    if (asksCompare || (asksThisWeek && asksLastWeek && /\battendance\b/.test(q))) {
      const data = await executeTool(
        'getAttendanceComparison',
        { periodA: 'this_week', periodB: 'last_week' },
        manager
      );
      const a = data?.period_a;
      const b = data?.period_b;
      let reply = '';
      if (b && data?.delta) {
        reply =
          `**Attendance compare** (IST weeks Mon–Sun)\n\n` +
          formatPeriodBlock(a, 'This week') +
          `\n` +
          formatPeriodBlock(b, 'Last week') +
          `\n**Delta (this − last):** attendance **${data.delta.attendance_pct_points >= 0 ? '+' : ''}${data.delta.attendance_pct_points}** pts · ` +
          `absent count **${data.delta.absent_count >= 0 ? '+' : ''}${data.delta.absent_count}** · ` +
          `late **${data.delta.late_count >= 0 ? '+' : ''}${data.delta.late_count}**.\n\n` +
          `${data.formula}`;
      } else if (a) {
        reply =
          formatPeriodBlock(a, a.label === 'last_week' ? 'Last week' : 'This week') +
          `\n${data.formula || ''}`;
      } else {
        reply = 'Could not compute attendance for that period.';
      }
      return { handled: true, reply, toolsUsed: ['getAttendanceComparison'] };
    }

    // Single-period attendance % / "attendance this week" totals
    if ((asksWeek && asksPct) || (asksWeek && /\battendance\b/.test(q) && !asksAbsent)) {
      const range = asksLastWeek && !asksThisWeek ? 'last_week' : 'this_week';
      const data = await executeTool('getAttendancePercentage', { range }, manager);
      const title = range === 'last_week' ? 'Last week' : 'This week';
      let reply;
      if (!data || data.synced_rows === 0) {
        reply =
          `**${title}** (${data?.start_date} → ${data?.end_date} IST):\n` +
          `No attendance rows synced in this range yet (not the same as 0% attendance).`;
      } else {
        reply =
          `**${data.attendance_pct}%** attendance ${title.toLowerCase()} ` +
          `(${data.start_date} → ${data.end_date} IST).\n` +
          `Present days **${data.present_days}** · Absent **${data.absent_days}** · Excused/leave **${data.excused_days}** · Late **${data.late_days}**\n` +
          `Synced days **${data.total_synced_days}** · Team with data **${data.team_size}** · Rows **${data.synced_rows}**\n\n` +
          `${data.formula || ''}`;
      }
      return { handled: true, reply, toolsUsed: ['getAttendancePercentage'] };
    }

    if (asksBrief) {
      const data = await executeTool('getDailyBriefing', {}, manager);
      const toolsUsed = ['getDailyBriefing'];
      const counts = data?.attendance || {};
      const present = counts.present ?? data?.present_count ?? '?';
      const late = counts.late ?? data?.late_count ?? '?';
      const absent = counts.absent ?? data?.absent_count ?? '?';
      const absentees = data?.absentees || [];
      const lateList = data?.late_arrivals || data?.late || [];
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
        `Missing EODs (**${data?.missing_eod_count ?? 0}**): ${listNames(data?.missing_eods || [])}\n` +
        `Overdue tasks: **${data?.overdue_count ?? 0}** · Interviews today: **${data?.interview_count ?? 0}**\n\n` +
        `Want names expanded or yesterday’s absentees?`;
      return { handled: true, reply, toolsUsed };
    }

    if (asksAbsent && asksYesterday) {
      const data = await executeTool('getAbsentees', { date: yesterdayIst }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** people marked **Absent** on **${yesterdayIst}** (yesterday, IST).\n\n` +
            `If that feels incomplete, hub sync may still be catching up — that is not the same as inventing absentees.`
          : `**${rows.length}** people were absent on **${yesterdayIst}** (yesterday, IST):\n` +
            rows.map((r) => `- **${r.name}**${r.email ? ` · ${r.email}` : ''}`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent && asksTomorrow) {
      const data = await executeTool('getAbsentees', { date: tomorrowIst }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** people marked **Absent** on **${tomorrowIst}** (tomorrow, IST).` +
            (data?.note ? `\n${data.note}` : '')
          : `**${rows.length}** absent on **${tomorrowIst}** (tomorrow, IST):\n` +
            rows.map((r) => `- **${r.name}**`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent && asksWeek) {
      const range = asksLastWeek && !asksThisWeek ? 'last_week' : 'this_week';
      const data = await executeTool('getAbsenteesList', { range }, manager);
      const people = data?.by_person || [];
      const rows = data?.absentees || [];
      if (!rows.length) {
        return {
          handled: true,
          reply:
            `**0** Absent rows for **${data?.start_date} → ${data?.end_date}** (IST, ${range}).\n` +
            (data?.note || 'If unexpected, sync Attendance — not the same as inventing absentees.'),
          toolsUsed: ['getAbsenteesList'],
        };
      }
      const reply =
        `**${data.unique_people || people.length}** people absent at least once · **${data.total_count}** absent day-rows ` +
        `(**${data.start_date} → ${data.end_date}** IST).\n\n` +
        people
          .map((p) => `- **${p.name}** — ${p.dates.join(', ')}`)
          .join('\n') +
        `\n\n${people.length} people listed above, matching ${data.unique_people || people.length} unique absentees.`;
      return { handled: true, reply, toolsUsed: ['getAbsenteesList'] };
    }

    if (asksAbsent) {
      const date = targetDay;
      const label = dayPick.relative;
      const data = await executeTool('getAbsentees', { date }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** absentees on **${date}** (${label}, IST).` +
            (data?.note ? `\n${data.note}` : '')
          : `**${rows.length}** absent on **${date}** (${label}, IST):\n` +
            rows.map((r) => `- **${r.name}**`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksLogin) {
      const data = await executeTool('getLoginTiming', { date: targetDay }, manager);
      const rows = data?.timings || data?.late || [];
      if (!rows.length) {
        return {
          handled: true,
          reply: `No login timing rows synced for **${todayIst}** (IST) yet.`,
          toolsUsed: ['getLoginTiming'],
        };
      }
      const lateOnly = rows.filter((r) => (r.late_minutes || 0) > 0 || r.status === 'Late');
      const reply =
        `Login timings for **${data?.date || todayIst}** (IST) — **${lateOnly.length}** late of **${rows.length}** with punches:\n` +
        (lateOnly.length
          ? lateOnly.slice(0, 30).map((r) => `- ${formatLateLine(r)}`).join('\n')
          : rows
              .slice(0, 15)
              .map(
                (r) =>
                  `- **${r.name}** — in ${formatTimeIst(r.first_in) || '—'}`
              )
              .join('\n'));
      return { handled: true, reply, toolsUsed: ['getLoginTiming'] };
    }

    if (
      !asksWeek &&
      !asksCompare &&
      (/\bpresent\b/.test(q) ||
        /\blate\b/.test(q) ||
        /\battendance\b/.test(q) ||
        /\broll\b/.test(q) ||
        /\bwho\s+(is|are)\s+here\b/.test(q))
    ) {
      // Never force "today" when manager said yesterday/tomorrow (incl. typos)
      const data = await executeTool('getAttendanceToday', { date: targetDay }, manager);
      const dayLabel =
        targetDay === yesterdayIst
          ? 'yesterday'
          : targetDay === tomorrowIst
            ? 'tomorrow'
            : 'today';
      if (data?.note && !(data.present?.length || data.late?.length || data.absent?.length)) {
        return {
          handled: true,
          reply:
            `No attendance data synced for **${data?.date || targetDay}** (${dayLabel}, IST) yet.\n\n` +
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
        `**${absent.length}** absent · **${late.length}** late · **${present.length}** present on **${data?.date || targetDay}** (${dayLabel}, IST).\n\n` +
        `**Late:**\n${lateLines}\n\n` +
        `**Absent:** ${listNames(absent)}\n\n` +
        `Want full present list or another day's absentees?`;
      return { handled: true, reply, toolsUsed: ['getAttendanceToday'] };
    }

    if (asksInterviews && !extractEmployeeName(userMessage)) {
      const data = await executeTool('getInterviewSchedule', { date: targetDay }, manager);
      const rows = data?.interviews || [];
      const reply =
        rows.length === 0
          ? `**0** interviews on **${todayIst}** (IST) in your scope.`
          : `**${rows.length}** interview(s) on **${data?.date || todayIst}** (IST):\n` +
            rows
              .slice(0, 25)
              .map((r) => {
                const when = formatTimeIst(r.scheduled_at || r.interview_time || r.time) || r.time || '—';
                return `- **${r.candidate_name || r.candidate || r.name}** · ${r.job_title || r.job || 'role n/a'} · ${when} · ${r.mode || r.round || ''}`;
              })
              .join('\n');
      return { handled: true, reply, toolsUsed: ['getInterviewSchedule'] };
    }

    // Team work board BEFORE pending-task short-circuit (overdue/open words are common here)
    if (asksTeamWork) {
      const data = await executeTool('getTeamWorkBoard', {}, manager);
      const emps = data?.employees || [];
      const t = data?.totals || {};
      if (!emps.length) {
        return {
          handled: true,
          reply: data?.message || 'No employees in your team scope.',
          toolsUsed: ['getTeamWorkBoard'],
        };
      }
      const lines = emps.map(
        (e) =>
          `- **${e.name}** — EOD: **${e.eod_status}** · open **${e.open_tasks}** · completed **${e.completed_tasks}** · overdue **${e.overdue_tasks}** · assigned total **${e.assigned_tasks_total}**`
      );
      const reply =
        `**Team work board** for **${data.date}** (IST) — **${t.employees}** employees:\n\n` +
        `• EODs submitted **${t.eod_submitted}** · missing **${t.eod_missing}**\n` +
        `• Open tasks **${t.open_tasks}** · completed **${t.completed_tasks}** · overdue **${t.overdue_tasks}**\n\n` +
        lines.join('\n') +
        `\n\n${emps.length} employees listed above, matching total_count **${data.total_count}**.`;
      return { handled: true, reply, toolsUsed: ['getTeamWorkBoard'] };
    }

    if (asksTasks && (!extractEmployeeName(userMessage) || asksTeamWide)) {
      const data = await executeTool('getPendingTasks', {}, manager);
      const rows = data?.tasks || [];
      const overdueOnly = /\boverdue\b/.test(q) && !/\bpending\b/.test(q);
      const focus = overdueOnly
        ? rows.filter((t) => {
            const due = t.due_date ? String(t.due_date).slice(0, 10) : null;
            return due && due < todayIst && due > '2000-01-01';
          })
        : rows;
      const reply =
        focus.length === 0
          ? `**0** ${overdueOnly ? 'overdue' : 'pending'} tasks in your team right now` +
            `${data?.total_count ? ` (hub open-task count: ${data.total_count})` : ''}.`
          : `**${focus.length}** ${overdueOnly ? 'overdue' : 'pending'} task(s)` +
            `${data?.total_count && data.total_count > focus.length ? ` (showing ${focus.length} of ${data.total_count} open)` : ''}:\n` +
            focus
              .slice(0, 50)
              .map(
                (t) =>
                  `- **${t.title || t.name}** · ${t.employee_name || t.assignee || '—'} · ${t.status || ''}${
                    t.due_date ? ` · due ${String(t.due_date).slice(0, 10)}` : ''
                  }`
              )
              .join('\n');
      return { handled: true, reply, toolsUsed: ['getPendingTasks'] };
    }

    if (asksEod && !extractEmployeeName(userMessage)) {
      const data = await executeTool('getMissingEODs', { date: targetDay }, manager);
      const missing = data?.missing_eods || [];
      const dayLabel =
        targetDay === yesterdayIst
          ? 'yesterday'
          : targetDay === tomorrowIst
            ? 'tomorrow'
            : 'today';
      const reply =
        `**${data?.total_count ?? missing.length}** missing EODs on **${data?.date || targetDay}** (${dayLabel}, IST).\n\n` +
        (missing.length
          ? missing.map((r) => `- **${r.name}**`).join('\n')
          : `No missing EODs for that date (or none synced yet).`);
      return { handled: true, reply, toolsUsed: ['getMissingEODs'] };
    }

    const person = extractEmployeeName(userMessage);
    if (person) {
      if (/\beod\b/.test(q) || /\bdaily\s+report/.test(q)) {
        const data = await executeTool('getLatestEod', { employeeName: person, days: 3 }, manager);
        if (data?.found === false) {
          return {
            handled: true,
            reply: data.message || `No employee matching **${person}** in your team.`,
            toolsUsed: ['getLatestEod'],
          };
        }
        if (data?.ambiguous) {
          return {
            handled: true,
            reply:
              `Multiple matches for **${person}**: ${data.matches?.join(', ')}. Which one?`,
            toolsUsed: ['getLatestEod'],
          };
        }
        const reports = data?.reports || [];
        const reply =
          reports.length === 0
            ? `No EOD reports synced for **${data?.employee || person}**.`
            : `Latest EODs for **${data.employee || person}**:\n` +
              reports
                .slice(0, 3)
                .map(
                  (r) =>
                    `- **${r.report_date || r.date}**: ${(r.achievements || r.summary || r.content || '—')
                      .toString()
                      .slice(0, 220)}`
                )
                .join('\n');
        return { handled: true, reply, toolsUsed: ['getLatestEod'] };
      }

      const data = await executeTool('getEmployeeFullProfile', { employeeName: person }, manager);
      if (data?.found === false) {
        return {
          handled: true,
          reply: data.message || `No employee matching **${person}** in your team.`,
          toolsUsed: ['getEmployeeFullProfile'],
        };
      }
      if (data?.ambiguous || data?.matches?.length > 1) {
        return {
          handled: true,
          reply: `Multiple matches for **${person}**: ${(data.matches || [])
            .map((m) => m.name || m)
            .join(', ')}. Which one?`,
          toolsUsed: ['getEmployeeFullProfile'],
        };
      }

      const att = data.attendance_today || data.today_attendance || data.attendance || {};
      const tasks = data.open_tasks || data.tasks || [];
      const eod = data.latest_eod || data.eod || null;
      const reply =
        `**${data.employee || data.name || person}** — hub snapshot for **${todayIst}** (IST).\n\n` +
        `• Shift: ${data.shift_start || att.shift_start || '09:30'}–${data.shift_end || att.shift_end || '19:00'} (late after ${data.late_after || att.late_after || '09:30'})\n` +
        `• Today: **${att.status || data.status || 'no attendance row'}**` +
        `${att.first_in ? ` · in ${formatTimeIst(att.first_in)}` : ''}` +
        `${att.late_minutes != null ? ` · ${att.late_minutes} min late` : ''}\n` +
        `• Open tasks (**${tasks.length}**): ${
          tasks.length
            ? tasks
                .slice(0, 8)
                .map((t) => t.title || t.name)
                .join('; ')
            : 'none'
        }\n` +
        `• Latest EOD: ${
          eod
            ? `**${eod.report_date || eod.date || '—'}** — ${(eod.achievements || eod.summary || 'submitted')
                .toString()
                .slice(0, 160)}`
            : 'none synced'
        }`;
      return { handled: true, reply, toolsUsed: ['getEmployeeFullProfile'] };
    }
  } catch (err) {
    console.warn('[hubFastAnswer]', err.message?.slice(0, 160));
    return { handled: false };
  }

  return { handled: false };
}
