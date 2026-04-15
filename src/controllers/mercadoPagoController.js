const prisma = require('../config/database');

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

    // Tenta encontrar o lead pelo telefone do pagador
    const payerPhone = payment.payer?.phone?.number
      || payment.payer?.phone?.area_code + payment.payer?.phone?.number
      || null;
    const payerEmail = payment.payer?.email || null;

    let lead = null;

    // Busca por telefone (limpa o número)
    if (payerPhone) {
      const cleanPhone = payerPhone.replace(/\D/g, '');
      lead = await prisma.lead.findFirst({
        where: {
          clientId,
          phone: { contains: cleanPhone },
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
      console.log(`[MP] Pagamento aprovado mas lead não encontrado. Telefone: ${payerPhone} Email: ${payerEmail}`);
      // Cria lead novo se veio de cliente MP
      if (payerPhone) {
        const cleanPhone = payerPhone.replace(/\D/g, '');
        lead = await prisma.lead.create({
          data: {
            phone: cleanPhone,
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
        console.log(`[MP] Lead criado automaticamente: ${lead.id}`);
      }
      return;
    }

    // Atualiza lead para convertido com o valor da venda
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: 'converted',
        stage: 'action',
        value: amount,
      },
    });

    // Registra interação de conversão
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'note',
        direction: 'inbound',
        content: `✅ Pagamento aprovado via Mercado Pago — R$ ${amount.toFixed(2)}`,
        metadata: JSON.stringify({ source: 'mercadopago', paymentId: payment.id }),
      },
    });

    console.log(`[MP] Lead ${lead.id} marcado como convertido — R$ ${amount}`);
  } catch (err) {
    console.error('[MP Webhook] Erro:', err.message);
  }
}

module.exports = { webhook };
