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

    // ─── Formato Brendi: busca detalhes do pedido na API deles ───────────────
    let parsedBody = body;
    let isCancelled = false;
    if (body.orderURL && body.eventType) {
      // Processa CONFIRMED, DELIVERED e CANCELLED
      const validEvents = ['CONFIRMED', 'DELIVERED', 'DISPATCHED', 'READY', 'CONCLUDED', 'CANCELLED'];
      if (!validEvents.includes(body.eventType)) {
        console.log(`[SaleWebhook] Evento Brendi ${body.eventType} ignorado`);
        return;
      }
      isCancelled = body.eventType === 'CANCELLED';
      try {
        console.log(`[SaleWebhook] Brendi — buscando detalhes do pedido: ${body.orderURL}`);
        const clientId_ = client.brendiClientId || '';
        const secret_ = client.brendiSecret || '';

        // Tenta diferentes combinações de autenticação
        const authAttempts = [
          { 'client-id': clientId_, 'Authorization': `Bearer ${secret_}` },
          { 'client-id': clientId_ },
          { 'Authorization': `Bearer ${clientId_}` },
          { 'client-id': secret_ },
          { 'Authorization': `Bearer ${clientId_}`, 'Content-Type': 'application/json' },
        ];

        let orderData = null;
        for (const headers of authAttempts) {
          const orderRes = await fetch(body.orderURL, { headers });
          if (orderRes.ok) {
            orderData = await orderRes.json();
            console.log(`[SaleWebhook] Brendi — pedido obtido com auth:`, JSON.stringify(headers));
            break;
          }
          console.log(`[SaleWebhook] Brendi — tentativa falhou (${orderRes.status}):`, JSON.stringify(headers));
        }

        if (orderData) {
          parsedBody = orderData;
        } else {
          // Se não conseguiu buscar, cria lead com orderId como identificador
          console.log(`[SaleWebhook] Brendi — usando orderId como identificador`);
          parsedBody = {
            ...body,
            phone: `brendi_${body.orderId}`,
            name: `Pedido Brendi #${body.orderId?.substring(0, 8)}`,
            total: 0,
          };
        }
      } catch (fetchErr) {
        console.error(`[SaleWebhook] Brendi — falha ao buscar pedido:`, fetchErr.message);
        parsedBody = {
          ...body,
          phone: `brendi_${body.orderId}`,
          name: `Pedido Brendi #${body.orderId?.substring(0, 8)}`,
          total: 0,
        };
      }
    }

    // ─── Extrai dados do pedido (compatível com vários formatos) ─────────────
    const amount = parseFloat(
      parsedBody.total || parsedBody.amount || parsedBody.value || parsedBody.order_total ||
      parsedBody.totalPrice || parsedBody.subTotal ||
      parsedBody.order?.total || parsedBody.purchase?.value ||
      parsedBody.data?.total || parsedBody.data?.amount || 0
    );

    const customer = parsedBody.customer || parsedBody.buyer || parsedBody.payer || parsedBody.client ||
      parsedBody.order?.customer || parsedBody.data?.customer || parsedBody;

    const rawPhone = customer.phone || customer.telephone || customer.mobile ||
      customer.celular || customer.telefone || parsedBody.phone || parsedBody.telephone || '';

    const email = customer.email || parsedBody.email || parsedBody.data?.email || null;

    const firstName = customer.first_name || customer.firstName || customer.name?.split(' ')[0] || '';
    const lastName = customer.last_name || customer.lastName || '';
    const name = customer.name || customer.nome ||
      (firstName ? `${firstName} ${lastName}`.trim() : null) ||
      parsedBody.name || parsedBody.nome || null;

    const orderId = parsedBody.id || parsedBody.order_id || parsedBody.orderId ||
      body.orderId || parsedBody.order?.id || parsedBody.data?.id || null;

    const phone = String(rawPhone).startsWith('brendi_') ? String(rawPhone) : String(rawPhone).replace(/\D/g, '');

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

    const leadStatus = isCancelled ? 'lost' : 'converted';
    const leadStage = isCancelled ? 'decision' : 'action';

    if (!lead && phone) {
      lead = await prisma.lead.create({
        data: {
          phone,
          name,
          email,
          source: 'website',
          status: leadStatus,
          stage: leadStage,
          clientId,
          value: isCancelled ? null : (amount || null),
        },
      });
      console.log(`[SaleWebhook] Lead criado: ${lead.id} — ${leadStatus}`);
    } else if (lead) {
      // Só atualiza status se não for rebaixar uma conversão para cancelado
      const novaData = {
        ...(name && !lead.name ? { name } : {}),
        ...(email && !lead.email ? { email } : {}),
      };
      if (!isCancelled) {
        novaData.status = 'converted';
        novaData.stage = 'action';
        novaData.value = amount || lead.value || null;
      } else if (!['converted'].includes(lead.status)) {
        novaData.status = 'lost';
        novaData.stage = 'decision';
      }
      await prisma.lead.update({ where: { id: lead.id }, data: novaData });
    }

    if (!lead) {
      console.log(`[SaleWebhook] Não foi possível identificar o lead`);
      return;
    }

    // ─── Registra nota ────────────────────────────────────────────────────────
    const noteContent = isCancelled
      ? `❌ Pedido cancelado pelo site${orderId ? ` — Pedido #${orderId}` : ''} (PIX expirado ou desistência)`
      : `✅ Venda confirmada pelo site${orderId ? ` — Pedido #${orderId}` : ''}${amount ? ` — R$ ${amount.toFixed(2)}` : ''}`;

    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'note',
        direction: 'inbound',
        content: noteContent,
        metadata: JSON.stringify({ source: 'website', orderId, amount, cancelled: isCancelled }),
      },
    });

    console.log(`[SaleWebhook] Lead ${lead.id} — ${isCancelled ? 'CANCELADO' : `convertido R$ ${amount}`}`);

    if (isCancelled) return; // Não dispara pixel nem WhatsApp em cancelamentos

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
    const isValidPhone = lead.phone && !lead.phone.startsWith('brendi_') && !lead.phone.startsWith('ig_');
    if (client.instanceName && isValidPhone) {
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
