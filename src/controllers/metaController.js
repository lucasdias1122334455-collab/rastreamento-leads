const prisma = require('../config/database');

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'rastreamento_leads_verify_2024';

// Verificação do webhook pela Meta
function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Meta] Webhook verificado!');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

// Recebimento de mensagens
async function webhook(req, res) {
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (const msg of messages) {
          if (msg.type !== 'text') continue;

          const phone = msg.from;
          const content = msg.text?.body || '[mídia]';
          const pushName = contacts.find(c => c.wa_id === phone)?.profile?.name || null;

          // Dados do anúncio (Click-to-WhatsApp)
          const referral = msg.referral || null;
          const adData = referral ? {
            adId: referral.source_id || null,
            adHeadline: referral.headline || null,
            adBody: referral.body || null,
            adSourceUrl: referral.source_url || null,
            adSourceType: referral.source_type || null,
          } : null;

          // Identifica o cliente pelo Phone Number ID
          let clientId = null;
          if (phoneNumberId) {
            const client = await prisma.client.findFirst({
              where: { metaPhoneNumberId: phoneNumberId }
            });
            if (client) clientId = client.id;
          }

          let lead = await prisma.lead.findUnique({ where: { phone } });
          if (!lead) {
            const tags = adData ? JSON.stringify(adData) : null;
            lead = await prisma.lead.create({
              data: {
                phone,
                name: pushName,
                source: 'whatsapp_meta',
                status: 'new',
                stage: 'awareness',
                clientId,
                tags,
              }
            });
          } else {
            const updates = {};
            if (pushName && !lead.name) updates.name = pushName;
            if (clientId && !lead.clientId) updates.clientId = clientId;
            if (adData && !lead.tags) updates.tags = JSON.stringify(adData);
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
              metadata: JSON.stringify({
                source: 'meta',
                phoneNumberId,
                referral: adData,
                rawMessage: msg,
              })
            }
          });

          console.log(`[Meta] Mensagem de ${phone} (${pushName})${adData ? ` | Anúncio: ${adData.adHeadline}` : ''}: ${content}`);
        }
      }
    }
  } catch (err) {
    console.error('[Meta Webhook] Erro:', err.message);
  }
}

module.exports = { verify, webhook };
