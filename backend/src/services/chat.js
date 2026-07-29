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
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  });
}

async function loadHistory(managerId, limit = 12) {
  const { rows } = await query(
    `SELECT role, content FROM chat_messages
     WHERE manager_id = $1 AND role IN ('user', 'assistant')
     ORDER BY created_at DESC LIMIT $2`,
    [managerId, limit]
  );
  return rows.reverse();
}

export async function chatWithGemini(manager, userMessage) {
  const model = getModel();
  const history = await loadHistory(manager.id);
  const { todayIst, nowIst } = nowInIst();

  const chat = model.startChat({
    history: history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  });

  const toolTrace = [];
  const contextualMessage = buildUserTurnWithContext(userMessage, { todayIst, nowIst });
  let result = await chat.sendMessage(contextualMessage);
  let response = result.response;

  for (let i = 0; i < 12; i++) {
    const calls = response.functionCalls?.() || [];
    if (!calls.length) break;

    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        const args = call.args || {};
        let toolResult;
        try {
          toolResult = await executeTool(call.name, args, manager);
        } catch (err) {
          toolResult = { error: 'Tool failed' };
        }
        // Persist only non-sensitive audit metadata in chat_messages.tool_trace
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

    result = await chat.sendMessage(functionResponses);
    response = result.response;
  }

  const text =
    response.text?.() ||
    "I couldn't pull that together just now — try once more, or ask a more specific name/date.";

  await query(
    `INSERT INTO chat_messages (manager_id, role, content) VALUES ($1, 'user', $2)`,
    [manager.id, userMessage]
  );
  await query(
    `INSERT INTO chat_messages (manager_id, role, content, tool_trace) VALUES ($1, 'assistant', $2, $3)`,
    [manager.id, text, JSON.stringify(toolTrace)]
  );

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
