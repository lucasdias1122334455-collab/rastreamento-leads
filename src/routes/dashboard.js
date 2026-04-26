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

// ─── KPIs em Tempo Real ───────────────────────────────────────────────────────
router.get('/kpis', async (req, res) => {
  try {
    const { clientId } = req.query;
    const cf = clientId ? `AND l."clientId" = ${Number(clientId)}` : '';

    const [rows] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT
          -- Total de conversas (interações de entrada)
          (SELECT COUNT(*)::int FROM interactions i LEFT JOIN leads l ON l.id = i."leadId" WHERE i.direction='inbound' ${cf.replace(/l\./g,'l.')}) AS "totalConversas",

          -- Conversas ativas (lead com mensagem nas últimas 24h)
          (SELECT COUNT(DISTINCT l.id)::int FROM leads l
           JOIN interactions i ON i."leadId" = l.id
           WHERE i."createdAt" > NOW() - INTERVAL '24 hours' AND i.direction = 'inbound' ${cf}) AS "ativas",

          -- Aguardando resposta (última msg foi do lead, sem resposta nossa)
          (SELECT COUNT(DISTINCT l.id)::int FROM leads l
           JOIN interactions i ON i."leadId" = l.id AND i.direction = 'inbound'
           WHERE NOT EXISTS (
             SELECT 1 FROM interactions o WHERE o."leadId" = l.id AND o.direction = 'outbound' AND o."createdAt" > i."createdAt"
           )
           AND i."createdAt" > NOW() - INTERVAL '7 days' ${cf}) AS "aguardando",

          -- Finalizadas (leads convertidos)
          (SELECT COUNT(*)::int FROM leads l WHERE l.status = 'converted' ${cf}) AS "finalizadas",

          -- Taxa de conversão %
          (SELECT CASE WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND((COUNT(*) FILTER (WHERE status = 'converted') * 100.0 / COUNT(*))::numeric, 1)
            END FROM leads l WHERE 1=1 ${cf}) AS "taxaConversao",

          -- Novos hoje
          (SELECT COUNT(*)::int FROM leads l WHERE l."createdAt" >= CURRENT_DATE ${cf}) AS "novoHoje",

          -- Total de leads
          (SELECT COUNT(*)::int FROM leads l WHERE 1=1 ${cf}) AS "totalLeads"
      `)
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error('[KPIs]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
