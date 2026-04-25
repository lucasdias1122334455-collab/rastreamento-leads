const { Router } = require('express');
const { getStats, getMetaStats, getConversionValues, getFunnelStats, exportLeads } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/database');

const router = Router();

router.use(authenticate);
router.get('/stats', getStats);
router.get('/meta-stats', getMetaStats);
router.get('/conversion-values', getConversionValues);
router.get('/funnel', getFunnelStats);
router.get('/export-leads', exportLeads);

// ─── GET /api/dashboard/sales-list ───────────────────────────────────────────
// Lista individual de vendas convertidas com nome, telefone, valor, canal, data
router.get('/sales-list', async (req, res) => {
  try {
    const { clientId, startDate, endDate, limit = 100 } = req.query;

    const conditions = [`l.status = 'converted'`];
    if (clientId)  conditions.push(`l."clientId" = ${Number(clientId)}`);
    if (startDate) conditions.push(`l."convertedAt" >= '${startDate}T00:00:00'`);
    if (endDate)   conditions.push(`l."convertedAt" <= '${endDate}T23:59:59'`);
    const where = conditions.join(' AND ');

    const leads = await prisma.$queryRawUnsafe(`
      SELECT l.id, l.name, l.phone, l.email, l.source, l.value, l."convertedAt", l.tags, c.name as "clientName"
      FROM leads l
      LEFT JOIN clients c ON c.id = l."clientId"
      WHERE ${where}
      ORDER BY l."convertedAt" DESC NULLS LAST
      LIMIT ${Number(limit)}
    `);

    const sourceLabel = {
      whatsapp:       'WhatsApp',
      whatsapp_meta:  'Meta Ads → WhatsApp',
      whatsapp_group: 'Grupo WhatsApp',
      instagram:      'Instagram',
      website:        'Site',
      mercadopago:    'Mercado Pago',
      manual:         'Manual',
    };

    const rows = leads.map(l => {
      let adName = null;
      try { const t = JSON.parse(l.tags || '{}'); adName = t.adHeadline || t.adName || null; } catch (_) {}
      const phone = l.phone?.startsWith('brendi_') ? '—' : l.phone || '—';
      return {
        id:          l.id,
        nome:        l.name || '—',
        telefone:    phone,
        email:       l.email || '—',
        canal:       sourceLabel[l.source] || l.source || '—',
        anuncio:     adName,
        valor:       l.value ? Number(l.value) : null,
        convertedAt: l.convertedAt,
        cliente:     l.clientName || null,
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
