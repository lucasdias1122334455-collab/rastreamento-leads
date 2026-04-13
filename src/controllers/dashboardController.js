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

module.exports = { getStats };
