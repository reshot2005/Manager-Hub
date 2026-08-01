import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { query } from '../config/db.js';
import { executeTool, toolDeclarations as rawTools } from '../tools/index.js';
import {
  buildManagerAiSystemInstruction,
  buildUserTurnWithContext,
} from './managerAiPrompt.js';
import { tryHubFastAnswer } from './hubFastAnswer.js';
import { getIstCalendar } from '../utils/istDates.js';

const TYPE_MAP = {
  OBJECT: SchemaType.OBJECT,
  STRING: SchemaType.STRING,
  NUMBER: SchemaType.NUMBER,
};

function mapSchema(schema) {
  if (!schema) return schema;
  const out = { ...schema };
  if (out.type && TYPE_MAP[out.type]) out.type = TYPE_MAP[out.type];
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, mapSchema(v)])
    );
  }
  return out;
}

const toolDeclarations = rawTools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: mapSchema(t.parameters),
}));

function nowInIst() {
  const cal = getIstCalendar();
  return {
    todayIst: cal.today,
    yesterdayIst: cal.yesterday,
    tomorrowIst: cal.tomorrow,
    nowIst: cal.nowLabel,
  };
}

/** After a model hits quota, prefer others for this long (ms). */
const MODEL_COOLDOWN_MS = Number(process.env.GEMINI_MODEL_COOLDOWN_MS || 5 * 60 * 1000);
/** modelName -> epoch ms when cooldown ends */
const modelCooldownUntil = new Map();

function markModelExhausted(modelName) {
  modelCooldownUntil.set(modelName, Date.now() + MODEL_COOLDOWN_MS);
}

/**
 * Free-tier rotation list.
 * GEMINI_MODELS=comma-separated overrides the built-in free defaults.
 * GEMINI_MODEL (if set) is tried first.
 */
function modelCandidates() {
  const preferred = (process.env.GEMINI_MODEL || '').trim();
  const fromEnv = (process.env.GEMINI_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Flash / Flash-Lite family — separate free-tier RPM/RPD buckets when possible.
  const freeDefaults = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
  ];

  const ordered = [
    ...new Set([...(preferred ? [preferred] : []), ...fromEnv, ...freeDefaults]),
  ];

  const now = Date.now();
  const ready = [];
  const cooling = [];
  for (const name of ordered) {
    if ((modelCooldownUntil.get(name) || 0) > now) cooling.push(name);
    else ready.push(name);
  }
  // Ready models first; recently exhausted last (in case quota recovered).
  return [...ready, ...cooling];
}

function isQuotaError(err) {
  const msg = String(err?.message || err || '');
  return (
    err?.status === 429 ||
    /\b429\b/.test(msg) ||
    /Too Many Requests/i.test(msg) ||
    /exceeded your current quota/i.test(msg) ||
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /quota.?exceeded/i.test(msg) ||
    /rate[_ ]?limit/i.test(msg)
  );
}

function isModelMissingError(err) {
  const msg = String(err?.message || err || '');
  return err?.status === 404 || /\b404\b/.test(msg) || /not found for API version/i.test(msg);
}

function getModel(modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key') {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildManagerAiSystemInstruction(),
    tools: [{ functionDeclarations: toolDeclarations }],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    }),
  ]);
}

async function loadHistory(managerId, limit = 8) {
  try {
    const { rows } = await withTimeout(
      query(
        `SELECT role, content FROM chat_messages
         WHERE manager_id = $1 AND role IN ('user', 'assistant')
         ORDER BY created_at DESC LIMIT $2`,
        [managerId, limit]
      ),
      6_000,
      'history'
    );
    return rows.reverse();
  } catch (err) {
    console.warn('[chat] history skip', err.message?.slice(0, 120));
    return [];
  }
}

async function persistTurn(managerId, userMessage, text, toolTrace) {
  try {
    await withTimeout(
      (async () => {
        await query(
          `INSERT INTO chat_messages (manager_id, role, content) VALUES ($1, 'user', $2)`,
          [managerId, userMessage]
        );
        await query(
          `INSERT INTO chat_messages (manager_id, role, content, tool_trace) VALUES ($1, 'assistant', $2, $3)`,
          [managerId, text, JSON.stringify(toolTrace)]
        );
      })(),
      6_000,
      'persist'
    );
  } catch (err) {
    console.warn('[chat] persist skip', err.message?.slice(0, 120));
  }
}

function friendlyFromTools(toolTrace, userMessage) {
  const names = toolTrace.map((t) => t.name).filter(Boolean);
  if (!names.length) {
    return (
      `Quick take: I started on **"${userMessage.slice(0, 80)}"** but couldn’t finish the AI write-up.\n\n` +
      `Try a clear ops question like *“who was absent yesterday”* or *“today’s briefing”* — I can still answer those straight from the hub.`
    );
  }
  return (
    `Quick take: I pulled hub data via **${names.join(', ')}**, but timed out before the final write-up.\n\n` +
    `Ask me again and I’ll finish the friendly summary with names and counts.`
  );
}

async function runGeminiLoop(manager, userMessage, { todayIst, nowIst, yIst, tIst }) {
  const onVercel = Boolean(process.env.VERCEL);
  const maxRounds = onVercel ? 5 : 12;
  const wallMs = onVercel ? 45_000 : 90_000;
  const geminiMs = onVercel ? 18_000 : 45_000;
  const toolMs = onVercel ? 10_000 : 30_000;
  const started = Date.now();
  const remaining = () => Math.max(1_500, wallMs - (Date.now() - started));

  const history = await loadHistory(manager.id, onVercel ? 6 : 12);
  const contextualMessage = buildUserTurnWithContext(userMessage, {
    todayIst,
    nowIst,
    yesterdayIst: yIst,
    tomorrowIst: tIst,
  });

  let lastErr = null;
  const tried = [];
  const candidates = modelCandidates();
  console.info('[chat] model queue', candidates.join(' → '));

  for (const modelName of candidates) {
    if (remaining() < 5_000) break;
    tried.push(modelName);
    try {
      const model = getModel(modelName);
      const chat = model.startChat({
        history: history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(m.content || '').slice(0, 4000) }],
        })),
      });

      const toolTrace = [];
      let result = await withTimeout(
        chat.sendMessage(contextualMessage),
        Math.min(geminiMs, remaining()),
        'gemini_first'
      );
      let response = result.response;

      for (let i = 0; i < maxRounds; i++) {
        if (remaining() < 4_000) break;
        const calls = response.functionCalls?.() || [];
        if (!calls.length) break;

        const functionResponses = await Promise.all(
          calls.map(async (call) => {
            const args = call.args || {};
            let toolResult;
            try {
              toolResult = await withTimeout(
                executeTool(call.name, args, manager),
                Math.min(toolMs, remaining() - 2_000),
                `tool_${call.name}`
              );
            } catch (err) {
              toolResult = {
                error: 'Tool timed out or failed',
                detail: String(err.message || err).slice(0, 160),
              };
            }
            toolTrace.push({ name: call.name, argKeys: Object.keys(args || {}) });
            return {
              functionResponse: { name: call.name, response: toolResult },
            };
          })
        );

        result = await withTimeout(
          chat.sendMessage(functionResponses),
          Math.min(geminiMs, remaining()),
          'gemini_tool_round'
        );
        response = result.response;
      }

      let text;
      try {
        text = response?.text?.() || null;
      } catch {
        text = null;
      }
      if (!text || !String(text).trim()) {
        text = friendlyFromTools(toolTrace, userMessage);
      }
      if (tried.length > 1) {
        console.info('[chat] answered with fallback model', modelName, 'after', tried.slice(0, -1).join(', '));
      }
      return { reply: text, toolsUsed: toolTrace.map((t) => t.name), toolTrace, modelName };
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err).slice(0, 200);
      console.warn('[chat] model fail', modelName, msg);

      if (isQuotaError(err)) {
        markModelExhausted(modelName);
        console.warn('[chat] quota on', modelName, '— switching to next free model');
        continue;
      }
      // Missing model / timeout / transient — try next in the free rotation.
      if (
        isModelMissingError(err) ||
        /_timeout$/i.test(String(err.message || '')) ||
        err?.status >= 500
      ) {
        continue;
      }
      // Other client errors: still try next model (keep chat available).
      continue;
    }
  }

  const detail = tried.length ? ` (tried: ${tried.join(', ')})` : '';
  throw lastErr || new Error(`All Gemini models failed${detail}`);
}

/**
 * Manager AI chat — hub-first for common ops questions, Gemini with model fallbacks.
 */
export async function chatWithGemini(manager, userMessage) {
  const { todayIst, nowIst, yesterdayIst: yIst, tomorrowIst: tIst } = nowInIst();

  const wantsPulse =
    /\b(how('s| is)? my team|team pulse|daily briefing|standup|what should i know|any alerts?)\b/i.test(
      userMessage || ''
    );

  let alertPrefix = '';
  let alertTools = [];
  if (wantsPulse) {
    try {
      const alerts = await executeTool('getActiveAlerts', {}, manager);
      alertTools = ['getActiveAlerts'];
      if (alerts?.total_count > 0) {
        const lines = (alerts.alerts || [])
          .slice(0, 15)
          .map(
            (a) =>
              `• **${a.severity}** — ${a.message}${a.employee_name ? ` (${a.employee_name})` : ''}`
          );
        alertPrefix =
          `**Unacknowledged alerts (${alerts.total_count}):**\n${lines.join('\n')}\n\n`;
      } else {
        alertPrefix = `**Alerts:** none unacknowledged.\n\n`;
      }
    } catch (err) {
      console.warn('[chat] alerts prefix', err.message?.slice(0, 120));
    }
  }

  // 1) Always answer common attendance/ops questions from hub (no Gemini dependency)
  const fast = await tryHubFastAnswer(manager, userMessage);
  if (fast.handled) {
    const reply = alertPrefix ? `${alertPrefix}${fast.reply}` : fast.reply;
    const toolsUsed = [...alertTools, ...(fast.toolsUsed || [])];
    const toolTrace = toolsUsed.map((name) => ({ name, argKeys: [] }));
    await persistTurn(manager.id, userMessage, reply, toolTrace);
    return { reply, toolsUsed, toolTrace };
  }

  // 2) Full Gemini + tools for everything else
  try {
    const result = await runGeminiLoop(manager, userMessage, { todayIst, nowIst, yIst, tIst });
    const reply = alertPrefix ? `${alertPrefix}${result.reply}` : result.reply;
    const toolsUsed = [...alertTools, ...(result.toolsUsed || [])];
    await persistTurn(manager.id, userMessage, reply, result.toolTrace);
    return { ...result, reply, toolsUsed };
  } catch (err) {
    // 3) Last resort: try hub patterns again / friendly recovery
    const fallback = await tryHubFastAnswer(manager, userMessage);
    if (fallback.handled) {
      const toolTrace = (fallback.toolsUsed || []).map((name) => ({ name, argKeys: [] }));
      await persistTurn(manager.id, userMessage, fallback.reply, toolTrace);
      return { reply: fallback.reply, toolsUsed: fallback.toolsUsed || [], toolTrace };
    }

    const quota = isQuotaError(err);
    const text = quota
      ? `All configured Gemini free models are exhausted right now (rate limit / daily cap).\n\n` +
        `I can still answer directly from the hub — try:\n` +
        `• **who was absent yesterday**\n` +
        `• **present / late today**\n` +
        `• **daily briefing**\n` +
        `• **interviews today** / **overdue tasks** / **missing EODs**\n` +
        `• **status of Name**\n\n` +
        `Or enable billing / wait for the quota reset in Google AI Studio.`
      : `I couldn’t reach the language model just now (${String(err.message || err).slice(0, 120)}).\n\n` +
        `I can still answer hub ops questions like **who was absent yesterday**, **present/late today**, or **daily briefing**.`;
    await persistTurn(manager.id, userMessage, text, []);
    return { reply: text, toolsUsed: [], toolTrace: [] };
  }
}

export async function getChatHistory(managerId, limit = 50) {
  const { rows } = await query(
    `SELECT id, role, content, created_at FROM chat_messages
     WHERE manager_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC LIMIT $2`,
    [managerId, limit]
  );
  return rows.reverse();
}

export async function clearChatHistory(managerId) {
  await query(`DELETE FROM chat_messages WHERE manager_id = $1`, [managerId]);
}
