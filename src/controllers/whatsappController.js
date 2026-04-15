const evolutionService = require('../services/evolutionService');
const claudeService = require('../services/claudeService');
const metaConversions = require('../services/metaConversionsService');
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
  res.sendStatus(200); // responde rápido pra Evolution não retentar

  try {
    const { event, instance, data } = req.body;
    if (event !== 'messages.upsert') return;
    if (!data || data?.key?.fromMe) return;

    const jid = data.key?.remoteJid || '';
    if (jid.includes('@g.us')) return; // ignora grupos

    const phone = jid.replace('@s.whatsapp.net', '');
    const pushName = data.pushName || null;

    // Detecta tipo de mensagem
    const isImage = !!(data.message?.imageMessage);
    const content =
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      (isImage ? '[imagem]' : '[mídia]');

    // Extrai base64 da imagem se vier direto no payload
    let imageBase64 = null;
    let imageMime = 'image/jpeg';
    if (isImage) {
      imageBase64 = data.message.imageMessage.base64 || null;
      imageMime = data.message.imageMessage.mimetype || 'image/jpeg';

      // Se não veio base64, tenta buscar via Evolution
      if (!imageBase64 && instance) {
        try {
          imageBase64 = await evolutionService.getMediaBase64(instance, data.key);
        } catch (_) {}
      }
    }

    // Identifica o cliente pela instância
    let client = null;
    if (instance) {
      client = await prisma.client.findUnique({ where: { instanceName: instance } });
    }
    const clientId = client?.id || null;

    // Busca ou cria o lead
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
        lead = { ...lead, ...updates };
      }
    }

    // Salva a mensagem recebida
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'message',
        direction: 'inbound',
        content,
        metadata: JSON.stringify({ rawMessage: data, isImage }),
      },
    });

    console.log(`[Webhook] Mensagem de ${phone} (${pushName}) via ${instance || 'default'}: ${content}`);

    // ─── Agente de IA ────────────────────────────────────────────────────────
    if (client?.aiEnabled) {
      if (isImage && imageBase64) {
        // Imagem recebida — Claude analisa se é comprovante de pagamento
        await runImageAgent({ lead, client, instance, imageBase64, imageMime });
      } else if (content !== '[mídia]') {
        // Mensagem de texto — conversa de vendas normal
        await runAIAgent({ lead, client, instance });
      }
    }

  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
  }
}

// ─── Agente de texto (vendas) ─────────────────────────────────────────────────
async function runAIAgent({ lead, client, instance }) {
  try {
    const messages = await prisma.interaction.findMany({
      where: { leadId: lead.id, type: 'message' },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    const last = messages[messages.length - 1];
    if (!last || last.direction !== 'inbound') return;

    const result = await claudeService.analyzeConversation({
      leadName: lead.name,
      messages,
      clientScript: client.aiScript || null,
      productValue: client.productValue || null,
      paymentLink: client.paymentLink || null,
    });

    if (!result || !result.reply) return;

    // Salva a resposta PRIMEIRO (independente do WhatsApp funcionar)
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'message',
        direction: 'outbound',
        content: result.reply,
        metadata: JSON.stringify({ ai: true, notes: result.notes || null }),
      },
    });

    // Tenta enviar pelo WhatsApp (se a instância não estiver conectada, não quebra o fluxo)
    try {
      await evolutionService.sendClientMessage(instance, lead.phone, result.reply);
    } catch (sendErr) {
      console.warn(`[AI] Falha ao enviar WA para ${lead.phone}:`, sendErr.message);
    }

    console.log(`[AI] Respondeu lead ${lead.phone}: ${result.reply.substring(0, 60)}...`);

    // Alerta de preço → manda WhatsApp pro responsável do cliente
    if (result.needsPriceAlert && client.phone && instance) {
      try {
        const leadName = lead.name || lead.phone;
        const alertMsg =
          `🔔 *Alerta de Lead — Preço Solicitado*\n\n` +
          `O lead *${leadName}* (${lead.phone}) perguntou sobre o preço de um produto.\n\n` +
          `Acesse o sistema e responda manualmente para não perder a venda! 💬`;
        await evolutionService.sendClientMessage(instance, client.phone, alertMsg);
        console.log(`[AI] Alerta de preço enviado para cliente ${client.phone}`);
      } catch (alertErr) {
        console.error('[AI] Erro ao enviar alerta de preço:', alertErr.message);
      }
    }

    // Intenção de compra → qualifica (conversão real vem do MP ou comprovante)
    if (result.converted && !['converted', 'qualified'].includes(lead.status)) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'qualified', stage: 'decision' },
      });
      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'note',
          direction: 'outbound',
          content: `🎯 Lead demonstrou intenção de compra — aguardando confirmação de pagamento`,
          metadata: JSON.stringify({ ai: true, purchaseIntent: true }),
        },
      });
      console.log(`[AI] Lead ${lead.phone} qualificado — intenção de compra detectada`);
    }

  } catch (err) {
    console.error('[AI Agent] Erro:', err.message);
  }
}

// ─── Agente de imagem (comprovante de pagamento) ──────────────────────────────
async function runImageAgent({ lead, client, instance, imageBase64, imageMime }) {
  try {
    const result = await claudeService.analyzePaymentReceipt({
      imageBase64,
      imageMime,
      leadName: lead.name,
      productValue: client.productValue || null,
    });

    if (!result) return;

    if (result.isPaymentReceipt && result.value) {
      // Comprovante confirmado — marca como convertido com valor real
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          stage: 'action',
          value: result.value,
        },
      });

      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'note',
          direction: 'outbound',
          content: `✅ Comprovante de pagamento recebido — R$ ${result.value.toFixed(2)} — Convertido automaticamente`,
          metadata: JSON.stringify({ ai: true, receipt: true, value: result.value }),
        },
      });

      console.log(`[AI] Lead ${lead.phone} CONVERTIDO via comprovante — R$ ${result.value}`);

      // Dispara evento Purchase no Meta Pixel se configurado
      if (client.pixelId && client.metaConversionsToken) {
        metaConversions.sendPurchaseEvent({
          pixelId: client.pixelId,
          accessToken: client.metaConversionsToken,
          value: result.value,
          phone: lead.phone,
          email: lead.email,
          name: lead.name,
          sourceUrl: client.website,
        }).catch(() => {});
      }

      // Responde confirmando o recebimento
      if (result.reply) {
        await evolutionService.sendClientMessage(instance, lead.phone, result.reply);
        await prisma.interaction.create({
          data: {
            leadId: lead.id,
            type: 'message',
            direction: 'outbound',
            content: result.reply,
            metadata: JSON.stringify({ ai: true }),
          },
        });
      }

    } else if (result.reply) {
      // Não era comprovante mas Claude quer responder algo
      await evolutionService.sendClientMessage(instance, lead.phone, result.reply);
      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'message',
          direction: 'outbound',
          content: result.reply,
          metadata: JSON.stringify({ ai: true }),
        },
      });
    }

  } catch (err) {
    console.error('[AI Image Agent] Erro:', err.message);
  }
}

module.exports = { getStatus, connect, disconnect, sendMessage, webhook };
