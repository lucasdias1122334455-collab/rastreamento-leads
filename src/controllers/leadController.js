const prisma = require('../config/database');

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost', 'disqualified'];
const VALID_STAGES = ['awareness', 'interest', 'decision', 'action'];

async function list(req, res, next) {
  try {
    const { status, stage, search, clientId, page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (status) where.status = status;
    if (stage) where.stage = stage;
    if (clientId) where.clientId = Number(clientId);
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        assignedTo: { select: { id: true, name: true } },
        interactions: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(lead);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, phone, email, source, status, stage, notes, tags, assignedToId, value } = req.body;
    if (!phone) return res.status(400).json({ error: 'Telefone é obrigatório' });

    const lead = await prisma.lead.create({
      data: {
        name,
        phone,
        email,
        source: source || 'manual',
        status: VALID_STATUSES.includes(status) ? status : 'new',
        stage: VALID_STAGES.includes(stage) ? stage : 'awareness',
        notes,
        tags: tags ? JSON.stringify(tags) : null,
        assignedToId: assignedToId ? Number(assignedToId) : null,
        value: value !== undefined && value !== '' ? Number(value) : null,
      },
    });

    res.status(201).json(lead);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe um lead com este telefone' });
    }
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { name, email, status, stage, notes, tags, assignedToId, value } = req.body;
    const id = Number(req.params.id);

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (status && VALID_STATUSES.includes(status)) data.status = status;
    if (stage && VALID_STAGES.includes(stage)) data.stage = stage;
    if (notes !== undefined) data.notes = notes;
    if (tags !== undefined) data.tags = JSON.stringify(tags);
    if (assignedToId !== undefined) data.assignedToId = assignedToId ? Number(assignedToId) : null;
    if (value !== undefined) data.value = value !== '' ? Number(value) : null;

    const lead = await prisma.lead.update({ where: { id }, data });
    res.json(lead);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lead não encontrado' });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await prisma.lead.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Lead não encontrado' });
    next(err);
  }
}

module.exports = { list, getById, create, update, remove };
