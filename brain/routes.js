// One "thinking" step. The browser runs the loop and asks permission before each tool.
const router = require('express').Router();
const rules = require('./rules');
const llm = require('./llm');

router.get('/status', async (req, res) => {
  res.json({ mode: (await llm.available()) ? `local AI · ${llm.MODEL}` : 'built-in brain' });
});

router.post('/step', async (req, res) => {
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  const last = history[history.length - 1];
  if (!last) return res.status(400).json({ error: 'empty history' });

  if (await llm.available()) {
    try { return res.json({ assistant: await llm.step(history) }); } catch { /* fall back to built-in */ }
  }

  if (last.role === 'tool') return res.json({ assistant: { role: 'assistant', content: rules.compose(history) } });
  const p = rules.plan(String(last.content || ''), history);
  res.json({ assistant: p.reply ? { role: 'assistant', content: p.reply } : { role: 'assistant', content: '', tool_calls: p.calls } });
});

module.exports = router;
