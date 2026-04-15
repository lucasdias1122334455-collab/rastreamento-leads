const prisma = require('../config/database');
const evolutionService = require('../services/evolutionService');

// Webhook do Mercado Pago — URL única por cliente:
// POST /api/mp/webhook/:clientId
async function webhook(req, res) {
  res.sendStatus(200); // Responde imediatamente para o MP não retentar

  try {
    const clientId = Number(req.params.clientId);
    const { type, action, data } = req.body;

    // MP envia "payment" ou "payment.updated" / "payment.created"
    const isPayment = type === 'payment' || action?.startsWith('payment');
    if (!isPayment || !data?.id) return;

    // Busca o cliente e seu access token
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client?.mpAccessToken) {
      console.log(`[MP] Cliente ${clientId} sem mpAccessToken`);
      return;
    }

    // Busca detalhes do pagamento na API do MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { Authorization: `Bearer ${client.mpAccessToken}` },
    });

    if (!mpRes.ok) {
      console.error(`[MP] Erro ao buscar pagamento ${data.id}:`, mpRes.status);
      return;
    }

    const payment = await mpRes.json();
    console.log(`[MP] Pagamento ${payment.id} status: ${payment.status} valor: ${payment.transaction_amount}`);

    if (payment.status !== 'approved') return;

    const amount = payment.transaction_amount || 0;
    const payerEmail = payment.payer?.email || null;

    // Monta possíveis variações do telefone do pagador
    const phoneVariants = buildPhoneVariants(payment.payer?.phone);

    let lead = null;

    // Busca por telefone
    if (phoneVariants.length) {
      lead = await prisma.lead.findFirst({
        where: {
          clientId,
          OR: phoneVariants.map(p => ({ phone: { contains: p } })),
        },
      });
    }

    // Busca por email se não achou por telefone
    if (!lead && payerEmail) {
      lead = await prisma.lead.findFirst({
        where: { clientId, email: payerEmail },
      });
    }

    if (!lead) {
      console.log(`[MP] Pagamento aprovado mas lead não encontrado. Criando novo lead.`);
      // Cria lead novo com status já convertido
      const phone = phoneVariants[0] || null;
      if (phone) {
        lead = await prisma.lead.create({
          data: {
            phone,
            name: payment.payer?.first_name
              ? `${payment.payer.first_name} ${payment.payer.last_name || ''}`.trim()
              : null,
            email: payerEmail,
            source: 'mercadopago',
            status: 'converted',
            stage: 'action',
            clientId,
            value: amount,
          },
        });

        await prisma.interaction.create({
          data: {
            leadId: lead.id,
            type: 'note',
            direction: 'inbound',
            content: `✅ Pagamento aprovado via Mercado Pago — R$ ${amount.toFixed(2)} — Lead criado automaticamente`,
            metadata: JSON.stringify({ source: 'mercadopago', paymentId: payment.id }),
          },
        });

        console.log(`[MP] Lead criado automaticamente: ${lead.id}`);
      }
      return;
    }

    // Atualiza lead para convertido com o valor real da venda
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: 'converted', stage: 'action', value: amount },
    });

    // Registra nota de conversão
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'note',
        direction: 'inbound',
        content: `✅ Pagamento aprovado via Mercado Pago — R$ ${amount.toFixed(2)}`,
        metadata: JSON.stringify({ source: 'mercadopago', paymentId: payment.id }),
      },
    });

    console.log(`[MP] Lead ${lead.id} convertido — R$ ${amount}`);

    // Manda mensagem de confirmação no WhatsApp do lead
    if (client.instanceName && lead.phone) {
      try {
        const firstName = lead.name ? lead.name.split(' ')[0] : null;
        const msg = firstName
          ? `✅ Pagamento confirmado, ${firstName}! Muito obrigado 🙏 Em breve entraremos em contato com os próximos passos.`
          : `✅ Pagamento confirmado! Muito obrigado 🙏 Em breve entraremos em contato com os próximos passos.`;

        await evolutionService.sendClientMessage(client.instanceName, lead.phone, msg);

        await prisma.interaction.create({
          data: {
            leadId: lead.id,
            type: 'message',
            direction: 'outbound',
            content: msg,
            metadata: JSON.stringify({ source: 'mercadopago', autoConfirmation: true }),
          },
        });

        console.log(`[MP] Confirmação enviada no WhatsApp para ${lead.phone}`);
      } catch (e) {
        console.error('[MP] Erro ao enviar confirmação WhatsApp:', e.message);
      }
    }

  } catch (err) {
    console.error('[MP Webhook] Erro:', err.message);
  }
}

// Gera variações do telefone para busca flexível
function buildPhoneVariants(phone) {
  if (!phone) return [];
  const area = String(phone.area_code || '').replace(/\D/g, '');
  const number = String(phone.number || '').replace(/\D/g, '');
  if (!number) return [];

  const variants = new Set();
  if (area) {
    variants.add(area + number);           // 11999999999
    variants.add('55' + area + number);    // 5511999999999
    // Com 9 dígito
    if (number.length === 8) {
      variants.add(area + '9' + number);
      variants.add('55' + area + '9' + number);
    }
    // Sem 9 dígito
    if (number.length === 9 && number.startsWith('9')) {
      variants.add(area + number.slice(1));
      variants.add('55' + area + number.slice(1));
    }
  }
  variants.add(number);
  return [...variants];
}

module.exports = { webhook };
