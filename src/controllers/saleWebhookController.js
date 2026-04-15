const prisma = require('../config/database');
const evolutionService = require('../services/evolutionService');
const metaConversions = require('../services/metaConversionsService');

/**
 * Webhook genérico de venda — recebe pedido do site/loja
 * POST /api/sale/webhook/:clientId
 *
 * Aceita qualquer formato de payload — tenta extrair:
 * phone, email, name, amount/total/value
 */
async function saleWebhook(req, res) {
  res.sendStatus(200); // Responde rápido

  try {
    const clientId = Number(req.params.clientId);
    const body = req.body;

    console.log(`[SaleWebhook] Cliente ${clientId} recebeu:`, JSON.stringify(body).substring(0, 300));

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client) {
      console.log(`[SaleWebhook] Cliente ${clientId} não encontrado`);
      return;
    }

    // ─── Extrai dados do pedido (compatível com vários formatos) ─────────────
    const amount = parseFloat(
      body.total || body.amount || body.value || body.order_total ||
      body.order?.total || body.purchase?.value ||
      body.data?.total || body.data?.amount || 0
    );

    const customer = body.customer || body.buyer || body.payer || body.client ||
      body.order?.customer || body.data?.customer || body;

    const rawPhone = customer.phone || customer.telephone || customer.mobile ||
      customer.celular || customer.telefone || body.phone || body.telephone || '';

    const email = customer.email || body.email || body.data?.email || null;

    const firstName = customer.first_name || customer.firstName || '';
    const lastName = customer.last_name || customer.lastName || '';
    const name = customer.name || customer.nome ||
      (firstName ? `${firstName} ${lastName}`.trim() : null) ||
      body.name || body.nome || null;

    const orderId = body.id || body.order_id || body.orderId ||
      body.order?.id || body.data?.id || null;

    const phone = String(rawPhone).replace(/\D/g, '');

    if (!phone && !email) {
      console.log(`[SaleWebhook] Pedido ${orderId} sem telefone ou email — ignorado`);
      return;
    }

    if (amount <= 0) {
      console.log(`[SaleWebhook] Pedido ${orderId} com valor inválido: ${amount}`);
    }

    // ─── Busca ou cria o lead ─────────────────────────────────────────────────
    let lead = null;

    if (phone) {
      lead = await prisma.lead.findFirst({
        where: {
          clientId,
          OR: [
            { phone: { contains: phone } },
            { phone: phone },
          ],
        },
      });
    }

    if (!lead && email) {
      lead = await prisma.lead.findFirst({
        where: { clientId, email },
      });
    }

    if (!lead && phone) {
      lead = await prisma.lead.create({
        data: {
          phone,
          name,
          email,
          source: 'website',
          status: 'converted',
          stage: 'action',
          clientId,
          value: amount || null,
        },
      });
      console.log(`[SaleWebhook] Lead criado automaticamente: ${lead.id}`);
    } else if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          stage: 'action',
          value: amount || lead.value || null,
          ...(name && !lead.name ? { name } : {}),
          ...(email && !lead.email ? { email } : {}),
        },
      });
    }

    if (!lead) {
      console.log(`[SaleWebhook] Não foi possível identificar o lead`);
      return;
    }

    // ─── Registra nota de conversão ───────────────────────────────────────────
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'note',
        direction: 'inbound',
        content: `✅ Venda confirmada pelo site${orderId ? ` — Pedido #${orderId}` : ''}${amount ? ` — R$ ${amount.toFixed(2)}` : ''}`,
        metadata: JSON.stringify({ source: 'website', orderId, amount }),
      },
    });

    console.log(`[SaleWebhook] Lead ${lead.id} convertido via site — R$ ${amount}`);

    // ─── Dispara Meta Pixel Purchase ──────────────────────────────────────────
    if (client.pixelId && client.metaConversionsToken && amount > 0) {
      metaConversions.sendPurchaseEvent({
        pixelId: client.pixelId,
        accessToken: client.metaConversionsToken,
        value: amount,
        phone: lead.phone,
        email: lead.email || email,
        name: lead.name || name,
        sourceUrl: client.website,
      }).catch(() => {});
    }

    // ─── Envia confirmação no WhatsApp ────────────────────────────────────────
    if (client.instanceName && lead.phone) {
      try {
        const firstName = lead.name ? lead.name.split(' ')[0] : null;
        const msg = firstName
          ? `✅ Pedido confirmado, ${firstName}! Muito obrigado 🙏 Em breve entraremos em contato.`
          : `✅ Pedido confirmado! Muito obrigado 🙏 Em breve entraremos em contato.`;

        await evolutionService.sendClientMessage(client.instanceName, lead.phone, msg);

        await prisma.interaction.create({
          data: {
            leadId: lead.id,
            type: 'message',
            direction: 'outbound',
            content: msg,
            metadata: JSON.stringify({ source: 'website', autoConfirmation: true }),
          },
        });
      } catch (e) {
        console.error('[SaleWebhook] Erro ao enviar WhatsApp:', e.message);
      }
    }

  } catch (err) {
    console.error('[SaleWebhook] Erro:', err.message);
  }
}

module.exports = { saleWebhook };
