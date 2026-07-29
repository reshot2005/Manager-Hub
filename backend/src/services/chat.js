import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { query } from '../config/db.js';
import { executeTool, toolDeclarations as rawTools } from '../tools/index.js';
import {
  buildManagerAiSystemInstruction,
  buildUserTurnWithContext,
} from './managerAiPrompt.js';

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
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return {
    todayIst: `${parts.year}-${parts.month}-${parts.day}`,
    nowIst: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} IST`,
  };
}

function yesterdayIst(todayIst) {
  const d = new Date(`${todayIst}T12:00:00+05:30`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key') {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildManagerAiSystemInstruction(),
    tools: [{ functionDeclarations: toolDeclarations }],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      maxOutputTokens: 2048,
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
      `Quick take: I started on **"${userMessage.slice(0, 80)}"** but ran out of time before tools finished.\n\n` +
      `Please ask once more — for absentees say *“who was absent yesterday”* and I’ll use getAbsentees with yesterday’s IST date.`
    );
  }
  return (
    `Quick take: I pulled hub data via **${names.join(', ')}**, but timed out before the final write-up.\n\n` +
    `Ask me again and I’ll finish the friendly summary with names and counts.`
  );
}

/**
 * Manager AI chat — optimized for Vercel (bounded rounds + wall-clock budget).
 */
export async function chatWithGemini(manager, userMessage) {
  const onVercel = Boolean(process.env.VERCEL);
  const maxRounds = onVercel ? 5 : 12;
  const wallMs = onVercel ? 45_000 : 90_000;
  const geminiMs = onVercel ? 18_000 : 45_000;
  const toolMs = onVercel ? 10_000 : 30_000;
  const started = Date.now();
  const remaining = () => Math.max(1_500, wallMs - (Date.now() - started));

  const model = getModel();
  const history = await loadHistory(manager.id, onVercel ? 6 : 12);
  const { todayIst, nowIst } = nowInIst();
  const yIst = yesterdayIst(todayIst);

  const chat = model.startChat({
    history: history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  });

  const toolTrace = [];
  const contextualMessage = buildUserTurnWithContext(userMessage, {
    todayIst,
    nowIst,
    yesterdayIst: yIst,
  });

  let result;
  let response;
  try {
    result = await withTimeout(
      chat.sendMessage(contextualMessage),
      Math.min(geminiMs, remaining()),
      'gemini_first'
    );
    response = result.response;
  } catch (err) {
    const text =
      `Quick take: I couldn’t reach the AI model just now (${String(err.message || err).slice(0, 80)}).\n\n` +
      `Please try again in a moment — I’m here to explain attendance, tasks, EODs, and interviews from the hub.`;
    await persistTurn(manager.id, userMessage, text, toolTrace);
    return { reply: text, toolsUsed: [], toolTrace };
  }

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
            hint: 'Retry with a narrower question (e.g. absentees for one date).',
          };
        }
        toolTrace.push({
          name: call.name,
          argKeys: Object.keys(args || {}),
        });
        return {
          functionResponse: {
            name: call.name,
            response: toolResult,
          },
        };
      })
    );

    try {
      result = await withTimeout(
        chat.sendMessage(functionResponses),
        Math.min(geminiMs, remaining()),
        'gemini_tool_round'
      );
      response = result.response;
    } catch {
      break;
    }
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

  await persistTurn(manager.id, userMessage, text, toolTrace);

  return { reply: text, toolsUsed: toolTrace.map((t) => t.name), toolTrace };
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
