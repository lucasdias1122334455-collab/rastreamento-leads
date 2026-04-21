const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const prisma = require('../config/database');

const router = Router();

// Aceita JWT normal OU ?apiKey= para Looker Studio / automações externas
router.use((req, res, next) => {
  const apiKey = req.query.apiKey;
  if (apiKey && process.env.REPORTS_API_KEY && apiKey === process.env.REPORTS_API_KEY) {
    return next(); // acesso via API key
  }
  return authenticate(req, res, next); // fallback para JWT
});

// Utilitário: gera CSV a partir de array de objetos
function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const val = r[h] ?? '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}

// ─── GET /api/reports/ads ──────────────────────────────────────────────────
// Performance por anúncio: leads, conversões, receita, CVR, ROAS
router.get('/ads', async (req, res) => {
  try {
    const { clientId, startDate, endDate, format = 'json' } = req.query;
    const clientFilter = clientId ? { clientId: Number(clientId) } : {};

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate)   dateFilter.lte = new Date(endDate + 'T23:59:59');

    const where = {
      ...clientFilter,
      source: 'whatsapp_meta',
      ...(startDate || endDate ? { createdAt: dateFilter } : {}),
    };

    const leads = await prisma.lead.findMany({
      where,
      select: { tags: true, status: true, value: true, createdAt: true },
    });

    // Agrupar por anúncio
    const adMap = {};
    for (const lead of leads) {
      let adName = 'Meta Ads (sem título)';
      let adId = null;
      if (lead.tags) {
        try {
          const t = JSON.parse(lead.tags);
          adName = t.adHeadline || t.adName || t.adId || adName;
          adId = t.adId || null;
        } catch (_) {}
      }

      if (!adMap[adName]) {
        adMap[adName] = { anuncio: adName, adId, leads: 0, convertidos: 0, perdidos: 0, receita: 0, investimento: 0 };
      }
      adMap[adName].leads++;
      if (lead.status === 'converted') {
        adMap[adName].convertidos++;
        adMap[adName].receita += Number(lead.value || 0);
      }
      if (lead.status === 'lost') adMap[adName].perdidos++;
    }

    // Puxar investimento da tabela ad_spend
    try {
      const spends = await prisma.$queryRawUnsafe(
        `SELECT "adKey", SUM(amount) as total FROM ad_spend ${clientId ? 'WHERE "clientId" = $1' : ''} GROUP BY "adKey"`,
        ...(clientId ? [Number(clientId)] : [])
      );
      for (const s of spends) {
        const match = Object.values(adMap).find(a => a.adId === s.adKey || a.anuncio === s.adKey);
        if (match) match.investimento = Number(s.total);
      }
    } catch (_) {}

    const rows = Object.values(adMap)
      .map(a => ({
        anuncio: a.anuncio,
        leads: a.leads,
        convertidos: a.convertidos,
        perdidos: a.perdidos,
        cvr: a.leads > 0 ? ((a.convertidos / a.leads) * 100).toFixed(1) + '%' : '0%',
        receita_brl: a.receita.toFixed(2),
        investimento_brl: a.investimento.toFixed(2),
        roas: a.investimento > 0 ? (a.receita / a.investimento).toFixed(2) : '-',
      }))
      .sort((a, b) => b.convertidos - a.convertidos);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="relatorio-anuncios.csv"');
      return res.send(toCSV(rows));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/daily ────────────────────────────────────────────────
// Evolução diária: novos leads + conversões + receita
router.get('/daily', async (req, res) => {
  try {
    const { clientId, startDate, endDate, format = 'json' } = req.query;

    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end   = endDate   || new Date().toISOString().slice(0, 10);

    const clientFilter = clientId ? `AND "clientId" = ${Number(clientId)}` : '';

    const leadsDaily = await prisma.$queryRawUnsafe(`
      SELECT DATE("createdAt") as dia, COUNT(*)::int as novos_leads
      FROM leads
      WHERE "createdAt" BETWEEN '${start}' AND '${end}T23:59:59' ${clientFilter}
      GROUP BY dia ORDER BY dia
    `);

    const convDaily = await prisma.$queryRawUnsafe(`
      SELECT DATE("convertedAt") as dia, COUNT(*)::int as conversoes, SUM(value)::numeric as receita
      FROM leads
      WHERE "convertedAt" BETWEEN '${start}' AND '${end}T23:59:59'
        AND status = 'converted' ${clientFilter}
      GROUP BY dia ORDER BY dia
    `);

    // Mesclar por dia
    const dayMap = {};
    for (const r of leadsDaily) {
      const d = String(r.dia).slice(0, 10);
      dayMap[d] = { data: d, novos_leads: r.novos_leads, conversoes: 0, receita_brl: '0.00' };
    }
    for (const r of convDaily) {
      const d = String(r.dia).slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { data: d, novos_leads: 0, conversoes: 0, receita_brl: '0.00' };
      dayMap[d].conversoes = r.conversoes;
      dayMap[d].receita_brl = Number(r.receita || 0).toFixed(2);
    }

    const rows = Object.values(dayMap).sort((a, b) => a.data.localeCompare(b.data));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="relatorio-diario.csv"');
      return res.send('\uFEFF' + toCSV(rows));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/funnel ───────────────────────────────────────────────
// Funil de conversão por etapa
router.get('/funnel', async (req, res) => {
  try {
    const { clientId, startDate, endDate, format = 'json' } = req.query;
    const clientFilter = clientId ? { clientId: Number(clientId) } : {};
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate)   dateFilter.lte = new Date(endDate + 'T23:59:59');
    const where = { ...clientFilter, ...(startDate || endDate ? { createdAt: dateFilter } : {}) };

    const [total, contacted, qualified, converted, lost] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'contacted' } }),
      prisma.lead.count({ where: { ...where, status: 'qualified' } }),
      prisma.lead.count({ where: { ...where, status: 'converted' } }),
      prisma.lead.count({ where: { ...where, status: 'lost' } }),
    ]);

    const totalReceita = await prisma.lead.aggregate({
      where: { ...where, status: 'converted' },
      _sum: { value: true },
    });

    const rows = [
      { etapa: 'Novos Leads',  quantidade: total,     pct_do_total: '100%' },
      { etapa: 'Contactados',  quantidade: contacted, pct_do_total: total > 0 ? ((contacted/total)*100).toFixed(1)+'%' : '0%' },
      { etapa: 'Qualificados', quantidade: qualified, pct_do_total: total > 0 ? ((qualified/total)*100).toFixed(1)+'%' : '0%' },
      { etapa: 'Convertidos',  quantidade: converted, pct_do_total: total > 0 ? ((converted/total)*100).toFixed(1)+'%' : '0%' },
      { etapa: 'Perdidos',     quantidade: lost,      pct_do_total: total > 0 ? ((lost/total)*100).toFixed(1)+'%' : '0%' },
      { etapa: 'Receita Total (R$)', quantidade: Number(totalReceita._sum.value || 0).toFixed(2), pct_do_total: '-' },
    ];

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="relatorio-funil.csv"');
      return res.send('\uFEFF' + toCSV(rows));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/reports/summary ─────────────────────────────────────────────
// Resumo geral — para o painel principal do Looker Studio
router.get('/summary', async (req, res) => {
  try {
    const { clientId, startDate, endDate, format = 'json' } = req.query;
    const clientFilter = clientId ? { clientId: Number(clientId) } : {};
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate)   dateFilter.lte = new Date(endDate + 'T23:59:59');
    const where = { ...clientFilter, ...(startDate || endDate ? { createdAt: dateFilter } : {}) };

    const [total, converted, lost] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'converted' } }),
      prisma.lead.count({ where: { ...where, status: 'lost' } }),
    ]);

    const receita = await prisma.lead.aggregate({
      where: { ...where, status: 'converted' },
      _sum: { value: true },
    });

    let investimento = 0;
    try {
      const spendRows = await prisma.$queryRawUnsafe(
        `SELECT SUM(amount) as total FROM ad_spend ${clientId ? 'WHERE "clientId" = $1' : ''}`,
        ...(clientId ? [Number(clientId)] : [])
      );
      investimento = Number(spendRows[0]?.total || 0);
    } catch (_) {}

    const receitaTotal = Number(receita._sum.value || 0);
    const rows = [{
      periodo_inicio: startDate || '-',
      periodo_fim: endDate || '-',
      total_leads: total,
      convertidos: converted,
      perdidos: lost,
      cvr: total > 0 ? ((converted/total)*100).toFixed(1)+'%' : '0%',
      receita_brl: receitaTotal.toFixed(2),
      investimento_brl: investimento.toFixed(2),
      roas: investimento > 0 ? (receitaTotal/investimento).toFixed(2) : '-',
      ticket_medio: converted > 0 ? (receitaTotal/converted).toFixed(2) : '0.00',
    }];

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="relatorio-resumo.csv"');
      return res.send('\uFEFF' + toCSV(rows));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
