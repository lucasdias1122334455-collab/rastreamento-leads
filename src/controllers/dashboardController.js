const prisma = require('../config/database');

async function getStats(req, res, next) {
  try {
    const [
      totalLeads,
      byStatus,
      byStage,
      bySource,
      recentInteractions,
      newLeadsToday,
    ] = await Promise.all([
      prisma.lead.count(),

      prisma.lead.groupBy({ by: ['status'], _count: { id: true } }),

      prisma.lead.groupBy({ by: ['stage'], _count: { id: true } }),

      prisma.lead.groupBy({ by: ['source'], _count: { id: true } }),

      prisma.interaction.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          lead: { select: { id: true, name: true, phone: true, client: { select: { id: true, name: true } } } },
          user: { select: { id: true, name: true } },
        },
      }),

      prisma.lead.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    res.json({
      totalLeads,
      newLeadsToday,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count.id])),
      byStage: Object.fromEntries(byStage.map((s) => [s.stage, s._count.id])),
      bySource: Object.fromEntries(bySource.map((s) => [s.source ?? 'unknown', s._count.id])),
      recentInteractions,
    });
  } catch (err) {
    next(err);
  }
}

async function getConversionValues(req, res, next) {
  try {
    const now = new Date();
    const clientFilter = req.query.clientId ? { clientId: Number(req.query.clientId) } : {};

    const sum = (leads) => leads.reduce((acc, l) => acc + (l.value || 0), 0);
    const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // ── Modo período customizado ──────────────────────────────────────────
    if (req.query.startDate && req.query.endDate) {
      const startDate = new Date(req.query.startDate + 'T00:00:00');
      const endDate   = new Date(req.query.endDate   + 'T23:59:59');

      // Leads convertidos no período
      const [dayLeads, weekLeads, monthLeads, allTime, rangeLeads] = await Promise.all([
        prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) }, ...clientFilter }, select: { value: true } }),
        prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: (() => { const d = new Date(now); d.setDate(now.getDate() - now.getDay()); d.setHours(0,0,0,0); return d; })() }, ...clientFilter }, select: { value: true } }),
        prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) }, ...clientFilter }, select: { value: true } }),
        prisma.lead.findMany({ where: { status: 'converted', ...clientFilter }, select: { value: true } }),
        prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: startDate, lte: endDate }, ...clientFilter }, select: { value: true, convertedAt: true } }),
      ]);

      // Monta mapa dia a dia no período selecionado
      const dailyMap = {};
      const diffDays = Math.ceil((endDate - startDate) / 86400000) + 1;
      for (let i = 0; i < diffDays; i++) {
        const d = new Date(startDate); d.setDate(d.getDate() + i);
        const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        dailyMap[key] = { count: 0, value: 0 };
      }
      rangeLeads.forEach(l => {
        const key = new Date(l.convertedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        if (dailyMap[key]) { dailyMap[key].count++; dailyMap[key].value += (l.value || 0); }
      });

      return res.json({
        summary: {
          today:   { count: dayLeads.length,   value: sum(dayLeads),   formatted: fmt(sum(dayLeads)) },
          week:    { count: weekLeads.length,   value: sum(weekLeads),  formatted: fmt(sum(weekLeads)) },
          month:   { count: monthLeads.length,  value: sum(monthLeads), formatted: fmt(sum(monthLeads)) },
          allTime: { count: allTime.length,     value: sum(allTime),    formatted: fmt(sum(allTime)) },
        },
        daily:   Object.entries(dailyMap).map(([date, d]) => ({ date, ...d })),
        weekly:  [],
        monthly: [],
      });
    }

    // ── Modo padrão ───────────────────────────────────────────────────────
    const startOfDay   = new Date(now); startOfDay.setHours(0,0,0,0);
    const startOfWeek  = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dayLeads, weekLeads, monthLeads, allTime] = await Promise.all([
      prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: startOfDay }, ...clientFilter }, select: { value: true, source: true } }),
      prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: startOfWeek }, ...clientFilter }, select: { value: true, source: true } }),
      prisma.lead.findMany({ where: { status: 'converted', convertedAt: { gte: startOfMonth }, ...clientFilter }, select: { value: true, source: true } }),
      prisma.lead.findMany({ where: { status: 'converted', ...clientFilter }, select: { value: true, source: true, convertedAt: true } }),
    ]);

    // Últimos 30 dias agrupados por dia
    const last30 = new Date(now); last30.setDate(now.getDate() - 29); last30.setHours(0,0,0,0);
    const last30Leads = await prisma.lead.findMany({
      where: { status: 'converted', updatedAt: { gte: last30 }, ...clientFilter },
      select: { value: true, updatedAt: true, source: true },
    });

    // Agrupa por dia
    const dailyMap = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(last30); d.setDate(d.getDate() + i);
      const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      dailyMap[key] = { count: 0, value: 0 };
    }
    last30Leads.forEach(l => {
      const key = new Date(l.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (dailyMap[key]) { dailyMap[key].count++; dailyMap[key].value += (l.value || 0); }
    });

    // Agrupa por semana (últimas 8 semanas)
    const weeklyMap = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i * 7);
      const weekStart = new Date(d); weekStart.setDate(d.getDate() - d.getDay()); weekStart.setHours(0,0,0,0);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
      const key = `${weekStart.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`;
      weeklyMap[key] = { count: 0, value: 0, weekStart, weekEnd };
    }
    allTime.forEach(l => {
      const date = new Date(l.updatedAt);
      Object.entries(weeklyMap).forEach(([key, w]) => {
        if (date >= w.weekStart && date <= w.weekEnd) { w.count++; w.value += (l.value || 0); }
      });
    });

    // Agrupa por mês (últimos 6 meses)
    const monthlyMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
      monthlyMap[key] = { count: 0, value: 0, year: d.getFullYear(), month: d.getMonth() };
    }
    allTime.forEach(l => {
      const d = new Date(l.updatedAt);
      Object.entries(monthlyMap).forEach(([key, m]) => {
        if (d.getFullYear() === m.year && d.getMonth() === m.month) { m.count++; m.value += (l.value || 0); }
      });
    });

    res.json({
      summary: {
        today:   { count: dayLeads.length,   value: sum(dayLeads),   formatted: fmt(sum(dayLeads)) },
        week:    { count: weekLeads.length,   value: sum(weekLeads),  formatted: fmt(sum(weekLeads)) },
        month:   { count: monthLeads.length,  value: sum(monthLeads), formatted: fmt(sum(monthLeads)) },
        allTime: { count: allTime.length,     value: sum(allTime),    formatted: fmt(sum(allTime)) },
      },
      daily:   Object.entries(dailyMap).map(([date, d]) => ({ date, ...d })),
      weekly:  Object.entries(weeklyMap).map(([week, d]) => ({ week, count: d.count, value: d.value })),
      monthly: Object.entries(monthlyMap).map(([month, d]) => ({ month, count: d.count, value: d.value })),
    });
  } catch (err) { next(err); }
}

async function getMetaStats(req, res, next) {
  try {
    const now = new Date();
    const clientFilter = req.query.clientId ? { clientId: Number(req.query.clientId) } : {};

    // Leads do Meta
    const metaLeads = await prisma.lead.findMany({
      where: { source: 'whatsapp_meta', ...clientFilter },
      select: { id: true, name: true, phone: true, status: true, tags: true, createdAt: true, clientId: true, client: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Totais gerais de origem (filtrado por cliente se necessário)
    const bySource = await prisma.lead.groupBy({
      by: ['source'],
      where: Object.keys(clientFilter).length ? clientFilter : undefined,
      _count: { id: true },
    });

    // Leads dos últimos 7 dias por dia
    const last7 = new Date(now);
    last7.setDate(last7.getDate() - 6);
    last7.setHours(0, 0, 0, 0);

    const recentMetaLeads = await prisma.lead.findMany({
      where: { source: 'whatsapp_meta', createdAt: { gte: last7 }, ...clientFilter },
      select: { createdAt: true, status: true },
    });

    // Agrupa por dia (últimos 7 dias)
    const dayMap = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(last7);
      d.setDate(d.getDate() + i);
      const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      dayMap[key] = 0;
    }
    recentMetaLeads.forEach(l => {
      const key = new Date(l.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (dayMap[key] !== undefined) dayMap[key]++;
    });

    // Agrupa por anúncio (a partir das tags do lead)
    const adMap = {};
    for (const lead of metaLeads) {
      let adKey = 'Orgânico / Desconhecido';
      let adId = null;
      if (lead.tags) {
        try {
          const parsed = JSON.parse(lead.tags);
          adKey = parsed.adHeadline || parsed.adId || 'Sem título';
          adId = parsed.adId || null;
        } catch (_) {}
      }

      if (!adMap[adKey]) {
        adMap[adKey] = { adId, total: 0, converted: 0, lost: 0, new: 0, contacted: 0, qualified: 0, clients: new Set() };
      }
      adMap[adKey].total++;
      adMap[adKey][lead.status] = (adMap[adKey][lead.status] || 0) + 1;
      if (lead.client?.name) adMap[adKey].clients.add(lead.client.name);
    }

    // Leads convertidos com valor por anúncio
    const convertedLeads = await prisma.lead.findMany({
      where: { source: 'whatsapp_meta', status: 'converted', value: { not: null }, ...clientFilter },
      select: { tags: true, value: true },
    });
    const returnMap = {};
    for (const l of convertedLeads) {
      let key = 'Orgânico / Desconhecido';
      if (l.tags) { try { const p = JSON.parse(l.tags); key = p.adHeadline || p.adId || 'Sem título'; } catch (_) {} }
      returnMap[key] = (returnMap[key] || 0) + (l.value || 0);
    }

    const adStats = Object.entries(adMap).map(([name, data]) => ({
      name,
      adId: data.adId,
      total: data.total,
      converted: data.converted || 0,
      lost: data.lost || 0,
      new: data.new || 0,
      contacted: data.contacted || 0,
      qualified: data.qualified || 0,
      conversionRate: data.total > 0 ? ((data.converted || 0) / data.total * 100).toFixed(1) : '0.0',
      clients: Array.from(data.clients),
      revenue: returnMap[name] || 0,
    })).sort((a, b) => b.total - a.total);

    // Status dos leads Meta
    const metaByStatus = {};
    metaLeads.forEach(l => { metaByStatus[l.status] = (metaByStatus[l.status] || 0) + 1; });

    res.json({
      total: metaLeads.length,
      converted: metaByStatus.converted || 0,
      conversionRate: metaLeads.length > 0
        ? ((metaByStatus.converted || 0) / metaLeads.length * 100).toFixed(1)
        : '0.0',
      byStatus: metaByStatus,
      byDay: Object.entries(dayMap).map(([date, count]) => ({ date, count })),
      byAd: adStats,
      allSources: Object.fromEntries(bySource.map(s => [s.source ?? 'manual', s._count.id])),
    });
  } catch (err) {
    next(err);
  }
}

async function getFunnelStats(req, res, next) {
  try {
    const days = parseInt(req.query.days) || 3;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const stageOrder = ['awareness', 'interest', 'decision', 'action'];
    const stageLabels = { awareness: 'Consciência', interest: 'Interesse', decision: 'Decisão', action: 'Ação' };

    const [byStage, byStatus, avgConversion, stuckLeads] = await Promise.all([
      // Contagem por etapa (excluindo perdidos)
      prisma.lead.groupBy({
        by: ['stage'],
        where: { status: { not: 'lost' } },
        _count: { id: true },
      }),

      // Contagem por status
      prisma.lead.groupBy({ by: ['status'], _count: { id: true } }),

      // Tempo médio de conversão (em dias)
      prisma.$queryRawUnsafe(`
        SELECT AVG(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 86400) as avg_days
        FROM leads WHERE status = 'converted'
      `),

      // Leads parados (sem interação nos últimos X dias, não convertidos, não perdidos)
      prisma.lead.findMany({
        where: {
          status: { notIn: ['converted', 'lost'] },
          OR: [
            // Nunca teve interação e foi criado há mais de X dias
            {
              interactions: { none: {} },
              createdAt: { lte: cutoff },
            },
            // Última interação foi há mais de X dias
            {
              interactions: {
                every: { createdAt: { lte: cutoff } },
                some: {},
              },
            },
          ],
        },
        select: {
          id: true, name: true, phone: true, status: true, stage: true, createdAt: true,
          client: { select: { name: true } },
          interactions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ]);

    const stageMap = Object.fromEntries(byStage.map(s => [s.stage, s._count.id]));
    const funnel = stageOrder.map((stage, i) => {
      const count = stageMap[stage] || 0;
      const prev = i === 0 ? null : (stageMap[stageOrder[i - 1]] || 0);
      const dropRate = prev && prev > 0 ? (((prev - count) / prev) * 100).toFixed(0) : null;
      return { stage, label: stageLabels[stage], count, dropRate };
    });

    const avgDays = avgConversion[0]?.avg_days ? parseFloat(avgConversion[0].avg_days).toFixed(1) : null;
    const statusMap = Object.fromEntries(byStatus.map(s => [s.status, s._count.id]));

    res.json({ funnel, avgConversionDays: avgDays, byStatus: statusMap, stuckLeads, stuckDays: days });
  } catch (err) { next(err); }
}

async function exportLeads(req, res, next) {
  try {
    const { status, stage, source, clientId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (stage) where.stage = stage;
    if (source) where.source = source;
    if (clientId) where.clientId = Number(clientId);

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { name: true } },
        assignedTo: { select: { name: true } },
        _count: { select: { interactions: true } },
      },
    });

    const statusLabels = { new: 'Novo', contacted: 'Contactado', qualified: 'Qualificado', converted: 'Convertido', lost: 'Perdido' };
    const stageLabels = { awareness: 'Consciência', interest: 'Interesse', decision: 'Decisão', action: 'Ação' };
    const sourceLabels = { whatsapp_meta: 'Meta Ads', whatsapp: 'WhatsApp QR', manual: 'Manual' };

    const header = ['ID', 'Nome', 'Telefone', 'Email', 'Status', 'Etapa', 'Origem', 'Cliente', 'Responsável', 'Valor (R$)', 'Interações', 'Criado em'];
    const rows = leads.map(l => [
      l.id,
      l.name || '',
      l.phone,
      l.email || '',
      statusLabels[l.status] || l.status,
      stageLabels[l.stage] || l.stage,
      sourceLabels[l.source] || l.source || '',
      l.client?.name || '',
      l.assignedTo?.name || '',
      l.value != null ? l.value.toFixed(2) : '',
      l._count.interactions,
      new Date(l.createdAt).toLocaleDateString('pt-BR'),
    ]);

    const csv = [header, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const bom = '\uFEFF'; // BOM para Excel reconhecer UTF-8
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(bom + csv);
  } catch (err) { next(err); }
}

module.exports = { getStats, getMetaStats, getConversionValues, getFunnelStats, exportLeads };
