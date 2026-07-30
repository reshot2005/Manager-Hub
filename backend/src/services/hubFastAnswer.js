/**
 * Deterministic hub answers when Gemini is slow/down/quota-limited.
 * Prefer tools-only for common ops — never invent data.
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
  for (const re of patterns) {
    const m = q.match(re);
    if (!m?.[1]) continue;
    const name = m[1]
      .replace(/\b(today|yesterday|please|now|team|the)\b/gi, '')
      .replace(/[?.!,]+$/g, '')
      .trim();
    if (name.length >= 2 && !/^(who|what|when|where|how|show|list|get|my)$/i.test(name)) {
      return name;
    }
  }
  return null;
}

/**
 * @returns {{ handled: true, reply: string, toolsUsed: string[] } | { handled: false }}
 */
export async function tryHubFastAnswer(manager, userMessage) {
  const q = String(userMessage || '').toLowerCase().trim();
  const { todayIst, yesterdayIst } = nowInIstParts();

  const asksAbsent =
    /\babsent/.test(q) ||
    /\bwho\b.*\bmissed\b/.test(q) ||
    /\bnot\s+present\b/.test(q);
  const asksYesterday = /\byesterday\b/.test(q) || /\blast\s+day\b/.test(q);
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
  const asksTeamWork =
    /\b(all|every|everyone|entire)\s+(employee|team|staff)/.test(q) ||
    /\bteam\s+work\b/.test(q) ||
    /\bwork\s+board\b/.test(q) ||
    (/\beod\b/.test(q) && /\b(all|everyone|team)\b/.test(q)) ||
    (/\btasks?\b/.test(q) &&
      /\b(assigned|completed|completion|open|done)\b/.test(q) &&
      /\b(all|everyone|team|each)\b/.test(q)) ||
    /\bassigned\s+vs\s+completed\b/.test(q) ||
    /\bcompleted\s+tasks?\b/.test(q) ||
    /\btask\s+status\s+(for\s+)?(all|everyone|team)\b/.test(q);
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
    // Week compare / weekly % — never route to getAttendanceToday
    if (
      asksCompare ||
      (asksWeek && asksPct) ||
      (asksWeek && /\battendance\b/.test(q) && !asksAbsent)
    ) {
      let finalArgs;
      if (asksCompare || (asksThisWeek && asksLastWeek)) {
        finalArgs = { periodA: 'this_week', periodB: 'last_week' };
      } else if (asksPct || (asksWeek && /\battendance\b/.test(q))) {
        finalArgs = { periodA: asksLastWeek && !asksThisWeek ? 'last_week' : 'this_week' };
        // Still include last week when user said "compare" already handled; for plain
        // "attendance this week" show this week + last week for context when they said compare only
        if (asksCompare) finalArgs.periodB = 'last_week';
      } else {
        finalArgs = { periodA: 'this_week', periodB: 'last_week' };
      }
      // Explicit: "compare … this week vs last week" always both periods
      if (asksCompare) finalArgs = { periodA: 'this_week', periodB: 'last_week' };

      const data = await executeTool('getAttendanceComparison', finalArgs, manager);
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
          ? `**0** people marked **Absent** on **${yesterdayIst}** (IST).\n\n` +
            `If that feels incomplete, hub sync may still be catching up — that is not the same as inventing absentees.`
          : `**${rows.length}** people were absent on **${yesterdayIst}** (IST):\n` +
            rows.map((r) => `- **${r.name}**${r.email ? ` · ${r.email}` : ''}`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent && asksWeek) {
      const range = asksLastWeek && !asksThisWeek ? 'last_week' : 'this_week';
      const data = await executeTool('getAbsentees', { range }, manager);
      const people = data?.by_person || [];
      const rows = data?.absentees || [];
      if (!rows.length) {
        return {
          handled: true,
          reply:
            `**0** Absent rows for **${data?.start_date} → ${data?.end_date}** (IST, ${range}).\n` +
            (data?.note || 'If unexpected, sync Attendance — not the same as inventing absentees.'),
          toolsUsed: ['getAbsentees'],
        };
      }
      const reply =
        `**${data.unique_people || people.length}** people absent at least once · **${data.total_count}** absent day-rows ` +
        `(**${data.start_date} → ${data.end_date}** IST).\n\n` +
        people
          .map((p) => `- **${p.name}** — ${p.dates.join(', ')}`)
          .join('\n') +
        `\n\n${people.length} people listed above, matching ${data.unique_people || people.length} unique absentees.`;
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksAbsent) {
      const date = todayIst;
      const data = await executeTool('getAbsentees', { date }, manager);
      const rows = data?.absentees || [];
      const reply =
        rows.length === 0
          ? `**0** absentees on **${date}** (IST).` +
            (data?.note ? `\n${data.note}` : '')
          : `**${rows.length}** absent on **${date}** (IST):\n` +
            rows.map((r) => `- **${r.name}**`).join('\n');
      return { handled: true, reply, toolsUsed: ['getAbsentees'] };
    }

    if (asksLogin) {
      const data = await executeTool('getLoginTiming', { date: todayIst }, manager);
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

    if (asksInterviews && !extractEmployeeName(q)) {
      const data = await executeTool('getInterviewSchedule', { date: todayIst }, manager);
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

    if (asksTasks && !extractEmployeeName(q)) {
      const data = await executeTool('getPendingTasks', {}, manager);
      const overdue = (data?.tasks || []).filter((t) => t.is_overdue || t.overdue);
      const focus = /\boverdue\b/.test(q) ? overdue : data?.tasks || [];
      const reply =
        focus.length === 0
          ? `**0** matching pending/overdue tasks in your team right now.`
          : `**${focus.length}** task(s)${/\boverdue\b/.test(q) ? ' overdue' : ' pending'}` +
            `${data?.total_count && data.total_count > focus.length ? ` (showing ${focus.length} of ${data.total_count})` : ''}:\n` +
            focus
              .slice(0, 40)
              .map(
                (t) =>
                  `- **${t.title || t.name}** · ${t.employee_name || t.assignee || '—'} · ${t.status || ''}${
                    t.due_date ? ` · due ${t.due_date}` : ''
                  }`
              )
              .join('\n');
      return { handled: true, reply, toolsUsed: ['getPendingTasks'] };
    }

    if (asksTeamWork || (asksEod && /\b(all|everyone|team|list)\b/.test(q) && !extractEmployeeName(q))) {
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

    if (asksEod && !extractEmployeeName(q)) {
      const data = await executeTool('getDailyBriefing', {}, manager);
      const missing = data?.missing_eods || [];
      const reply =
        `**${data?.missing_eod_count ?? missing.length}** missing EODs on **${data?.date || todayIst}** (IST).\n` +
        `Submitted today: **${data?.eods_submitted_today ?? 0}**.\n\n` +
        (missing.length
          ? missing.map((r) => `- **${r.name}**`).join('\n')
          : 'Everyone in scope has an EOD for today (or none synced yet).');
      return { handled: true, reply, toolsUsed: ['getDailyBriefing'] };
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
