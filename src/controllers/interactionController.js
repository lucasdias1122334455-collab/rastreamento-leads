const prisma = require('../config/database');

async function listByLead(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    const interactions = await prisma.interaction.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
    res.json(interactions);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { type, direction, content, metadata } = req.body;
    const leadId = Number(req.params.leadId);

    if (!type || !content) {
      return res.status(400).json({ error: 'Tipo e conteúdo são obrigatórios' });
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    const interaction = await prisma.interaction.create({
      data: {
        leadId,
        userId: req.user?.id ?? null,
        type,
        direction,
        content,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    res.status(201).json(interaction);
  } catch (err) {
    next(err);
  }
}

module.exports = { listByLead, create };
