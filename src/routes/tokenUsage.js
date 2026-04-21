const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const tokenTracker = require('../services/tokenTracker');

const router = Router();
router.use(authenticate);

// Apenas admin pode ver
router.use((req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
  next();
});

// GET /api/tokens/summary?startDate=2026-04-01&endDate=2026-04-30
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startDate = req.query.startDate || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const endDate   = req.query.endDate   || now.toISOString().slice(0,10);
    const [byClient, total] = await Promise.all([
      tokenTracker.getSummary(startDate, endDate),
      tokenTracker.getTotal(startDate, endDate),
    ]);
    res.json({ startDate, endDate, byClient, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
