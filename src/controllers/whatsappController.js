const evolutionService = require('../services/evolutionService');
const prisma = require('../config/database');

async function getStatus(req, res, next) {
  try {
    const status = await evolutionService.getStatus();
    if (status.status !== 'connected') {
      try { status.qrCode = await evolutionService.getQRCode(); } catch (_) {}
    }
    res.json(status);
  } catch (err) {
    next(err);
  }
}

async function connect(req, res, next) {
  try {
    const qrCode = await evolutionService.getQRCode();
    res.json({ message: 'QR Code gerado', qrCode });
  } catch (err) {
    next(err);
  }
}

async function disconnect(req, res, next) {
  try {
    await evolutionService.disconnectInstance();
    res.json({ message: 'Desconectado com sucesso' });
  } catch (err) {
    next(err);
  }
}

async function sendMessage(req, res, next) {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Telefone e mensagem são obrigatórios' });
    }
    await evolutionService.sendMessage(phone, message);
    res.json({ message: 'Mensagem enviada' });
  } catch (err) {
    next(err);
  }
}

async function webhook(req, res) {
  res.sendStatus(200);

  try {
    const { event, instance, data } = req.body;
    if (event !== 'messages.upsert') return;
    if (!data || data?.key?.fromMe) return;

    const jid = data.key?.remoteJid || '';
    if (jid.includes('@g.us')) return; // ignora grupos

    const phone = jid.replace('@s.whatsapp.net', '');
    const content =
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      '[mídia]';
    const pushName = data.pushName || null;

    // Identifica o cliente pela instância
    let clientId = null;
    if (instance) {
      const client = await prisma.client.findUnique({ where: { instanceName: instance } });
      if (client) clientId = client.id;
    }

    let lead = await prisma.lead.findUnique({ where: { phone } });
    if (!lead) {
      lead = await prisma.lead.create({
        data: { phone, name: pushName, source: 'whatsapp', status: 'new', stage: 'awareness', clientId },
      });
    } else {
      const updates = {};
      if (pushName && !lead.name) updates.name = pushName;
      if (clientId && !lead.clientId) updates.clientId = clientId;
      if (Object.keys(updates).length) {
        await prisma.lead.update({ where: { id: lead.id }, data: updates });
      }
    }

    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'message',
        direction: 'inbound',
        content,
        metadata: JSON.stringify({ rawMessage: data }),
      },
    });

    console.log(`[Webhook] Mensagem de ${phone} (${pushName}) via ${instance}: ${content}`);
  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
  }
}

module.exports = { getStatus, connect, disconnect, sendMessage, webhook };
