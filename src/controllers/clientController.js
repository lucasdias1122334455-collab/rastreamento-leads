const prisma = require('../config/database');
const evolutionService = require('../services/evolutionService');

function toInstanceName(name) {
  // Nome fixo baseado no nome do cliente — sem timestamp para evitar duplicatas
  return 'c_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 40);
}

async function listClients(req, res, next) {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { leads: true } } },
    });
    res.json(clients);
  } catch (err) { next(err); }
}

async function createClient(req, res, next) {
  try {
    const { name, phone, email, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const instanceName = toInstanceName(name);

    const client = await prisma.client.create({
      data: { name, phone, email, notes, instanceName },
    });

    // Cria instância na Evolution API
    try {
      await evolutionService.createClientInstance(instanceName);
    } catch (e) {
      console.error('[Client] Erro ao criar instância Evolution:', e.message);
    }

    res.status(201).json(client);
  } catch (err) { next(err); }
}

async function getClient(req, res, next) {
  try {
    const client = await prisma.client.findUnique({
      where: { id: Number(req.params.id) },
      include: { _count: { select: { leads: true } } },
    });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(client);
  } catch (err) { next(err); }
}

async function updateClient(req, res, next) {
  try {
    const { name, phone, email, notes, metaPhoneNumberId, mpAccessToken, aiEnabled, aiScript, productValue, paymentLink } = req.body;
    const data = { name, phone, email, notes };
    if (metaPhoneNumberId !== undefined) data.metaPhoneNumberId = metaPhoneNumberId || null;
    if (mpAccessToken !== undefined) data.mpAccessToken = mpAccessToken || null;
    if (aiEnabled !== undefined) data.aiEnabled = Boolean(aiEnabled);
    if (aiScript !== undefined) data.aiScript = aiScript || null;
    if (productValue !== undefined) data.productValue = productValue ? parseFloat(productValue) : null;
    if (paymentLink !== undefined) data.paymentLink = paymentLink || null;
    const client = await prisma.client.update({
      where: { id: Number(req.params.id) },
      data,
    });
    res.json(client);
  } catch (err) { next(err); }
}

async function deleteClient(req, res, next) {
  try {
    const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    try {
      await evolutionService.deleteClientInstance(client.instanceName);
    } catch (e) {
      console.error('[Client] Erro ao deletar instância Evolution:', e.message);
    }

    await prisma.client.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Cliente removido' });
  } catch (err) { next(err); }
}

async function getClientWhatsAppStatus(req, res, next) {
  try {
    const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    const status = await evolutionService.getClientStatus(client.instanceName);
    let qrCode = null;

    // Só gera QR se status for connecting (já iniciou conexão) — não no disconnected
    if (status === 'connecting') {
      try { qrCode = await evolutionService.getClientQRCode(client.instanceName); } catch (_) {}
    }
    res.json({ status, qrCode });
  } catch (err) { next(err); }
}

async function connectClientWhatsApp(req, res, next) {
  try {
    const client = await prisma.client.findUnique({ where: { id: Number(req.params.id) } });
    if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

    // Se instância não existe, recria automaticamente
    const currentStatus = await evolutionService.getClientStatus(client.instanceName);
    if (currentStatus === 'disconnected') {
      try { await evolutionService.createClientInstance(client.instanceName); } catch (_) {}
    }

    // Gera QR code
    let qrCode = null;
    try { qrCode = await evolutionService.getClientQRCode(client.instanceName); } catch (_) {}
    const status = await evolutionService.getClientStatus(client.instanceName);
    res.json({ status, qrCode });
  } catch (err) { next(err); }
}

async function getClientLeads(req, res, next) {
  try {
    const leads = await prisma.lead.findMany({
      where: { clientId: Number(req.params.id) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { interactions: true } } },
    });
    res.json(leads);
  } catch (err) { next(err); }
}

module.exports = { listClients, createClient, getClient, updateClient, deleteClient, getClientWhatsAppStatus, connectClientWhatsApp, getClientLeads };
