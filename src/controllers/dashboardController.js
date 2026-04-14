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
          lead: { select: { id: true, name: true, phone: true } },
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

async function getMetaStats(req, res, next) {
  try {
    const now = new Date();
    const last30 = new Date(now);
    last30.setDate(last30.getDate() - 30);

    // Leads do Meta nos últimos 30 dias
    const metaLeads = await prisma.lead.findMany({
      where: { source: 'whatsapp_meta' },
      select: { id: true, name: true, phone: true, status: true, tags: true, createdAt: true, clientId: true },
      orderBy: { createdAt: 'desc' },
    });

    // Totais gerais de origem
    const bySource = await prisma.lead.groupBy({
      by: ['source'],
      _count: { id: true },
    });

    // Leads dos últimos 7 dias por dia
    const last7 = new Date(now);
    last7.setDate(last7.getDate() - 6);
    last7.setHours(0, 0, 0, 0);

    const recentMetaLeads = await prisma.lead.findMany({
      where: { source: 'whatsapp_meta', createdAt: { gte: last7 } },
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
        adMap[adKey] = { adId, total: 0, converted: 0, lost: 0, new: 0, contacted: 0, qualified: 0 };
      }
      adMap[adKey].total++;
      adMap[adKey][lead.status] = (adMap[adKey][lead.status] || 0) + 1;
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

module.exports = { getStats, getMetaStats };
