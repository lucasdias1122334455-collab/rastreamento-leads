const prisma = require('../config/database');

function getAdKey(lead) {
  if (lead.source === 'whatsapp_meta' && lead.tags) {
    try {
      const parsed = JSON.parse(lead.tags);
      return parsed.adHeadline || parsed.adId || 'Meta Ads (sem título)';
    } catch (_) { return 'Meta Ads'; }
  }
  if (lead.source === 'manual') return 'Manual';
  return 'WhatsApp QR Code';
}

async function getAdGroups(req, res, next) {
  try {
    const { clientId } = req.query;
    const where = {};
    if (clientId) where.clientId = Number(clientId);

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, tags: true, source: true, status: true },
    });

    const groups = {};
    for (const lead of leads) {
      const key = getAdKey(lead);
      if (!groups[key]) {
        groups[key] = { key, source: lead.source, total: 0, converted: 0, new: 0 };
      }
      groups[key].total++;
      if (lead.status === 'converted') groups[key].converted++;
      if (lead.status === 'new') groups[key].new++;
    }

    // Pasta especial: Carrinho Abandonado (leads do site com status lost)
    const abandoned = leads.filter(l => l.source === 'website' && l.status === 'lost');
    if (abandoned.length > 0) {
      groups['__abandoned__'] = { key: '__abandoned__', source: 'website', total: abandoned.length, converted: 0, new: 0, isAbandoned: true };
    }

    res.json(Object.values(groups).sort((a, b) => b.total - a.total));
  } catch (err) { next(err); }
}

async function getLeadsByAd(req, res, next) {
  try {
    const { adKey, clientId } = req.query;
    const where = {};
    if (clientId) where.clientId = Number(clientId);

    const allLeads = await prisma.lead.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, name: true, phone: true, status: true, stage: true,
        source: true, tags: true, updatedAt: true, createdAt: true,
        client: { select: { id: true, name: true } },
        interactions: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, createdAt: true, direction: true } },
      },
    });

    // Pasta especial: Carrinho Abandonado
    if (adKey === '__abandoned__') {
      const abandoned = allLeads.filter(l => l.source === 'website' && l.status === 'lost');
      return res.json(abandoned);
    }

    const filtered = allLeads.filter(lead => getAdKey(lead) === adKey);
    res.json(filtered);
  } catch (err) { next(err); }
}

async function getConversation(req, res, next) {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        assignedTo: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        interactions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(lead);
  } catch (err) { next(err); }
}

module.exports = { getAdGroups, getLeadsByAd, getConversation };
