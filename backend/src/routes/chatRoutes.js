import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimits.js';
import { chatWithGemini, getChatHistory, clearChatHistory } from '../services/chat.js';
import { asString } from '../utils/validate.js';
import { logServerError, safeClientError } from '../utils/safeError.js';

const router = Router();

router.post('/', requireAuth, chatLimiter, async (req, res) => {
  try {
    const message = asString(req.body?.message, { max: 4000, min: 1 });
    if (!message) {
      return res.status(400).json({ message: 'message is required' });
    }

    const { reply, toolsUsed } = await chatWithGemini(req.manager, message);
    res.json({ reply, toolsUsed });
  } catch (err) {
    logServerError('[chat]', err);
    const status = err.message?.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({
      message:
        status === 503
          ? 'AI service is not configured'
          : safeClientError(err, 'Chat failed'),
    });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const history = await getChatHistory(req.manager.id);
    res.json({ history });
  } catch (err) {
    logServerError('[chat/history]', err);
    res.status(500).json({ message: safeClientError(err, 'Failed to load history') });
  }
});

router.delete('/history', requireAuth, async (req, res) => {
  try {
    await clearChatHistory(req.manager.id);
    res.json({ ok: true });
  } catch (err) {
    logServerError('[chat/clear]', err);
    res.status(500).json({ message: safeClientError(err, 'Failed to clear history') });
  }
});

export default router;
