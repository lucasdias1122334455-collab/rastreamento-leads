const prisma = require('../config/database');
const claudeService = require('../services/claudeService');
const metaConversions = require('../services/metaConversionsService');

const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || 'leadtrack_instagram_2024';

// GET /api/instagram/webhook — Meta webhook verification
async function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Instagram] Webhook verificado');
    return res.send(challenge);
  }
  res.sendStatus(403);
}

// POST /api/instagram/webhook — incoming DM
async function receiveMessage(req, res) {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'instagram') return;

    for (const entry of body.entry || []) {
      const igAccountId = entry.id;
      for (const event of entry.messaging || []) {
        if (!event.message || event.message.is_echo) continue;

        const senderId = event.sender.id;
        const messageId = event.message.mid;

        // Detecta imagem/anexo
        const attachment = event.message.attachments?.[0];
        const isImage = attachment?.type === 'image';
        const imageUrl = isImage ? attachment?.payload?.url : null;
        const text = event.message.text || (isImage ? '[imagem]' : '[mídia]');

        // Find client by Instagram account ID
        const client = await prisma.client.findFirst({
          where: { instagramAccountId: igAccountId },
        });
        if (!client) {
          console.log(`[Instagram] Nenhum cliente para conta ${igAccountId}`);
          continue;
        }

        // Find or create lead by Instagram sender ID (stored as phone field prefixed)
        const igPhone = `ig_${senderId}`;
        let lead = await prisma.lead.findFirst({
          where: { clientId: client.id, phone: igPhone },
          include: { interactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        });

        if (!lead) {
          // Try to get Instagram name via Graph API
          let igName = null;
          if (client.instagramToken) {
            try {
              const r = await fetch(`https://graph.facebook.com/v19.0/${senderId}?fields=name&access_token=${client.instagramToken}`);
              const data = await r.json();
              igName = data.name || null;
            } catch (_) {}
          }

          lead = await prisma.lead.create({
            data: {
              phone: igPhone,
              name: igName,
              source: 'instagram',
              status: 'new',
              stage: 'awareness',
              clientId: client.id,
            },
            include: { interactions: true },
          });
          console.log(`[Instagram] Lead criado: ${lead.id} — ${igName || senderId}`);
        }

        // Save incoming message
        await prisma.interaction.create({
          data: {
            leadId: lead.id,
            type: 'message',
            direction: 'inbound',
            content: text,
            metadata: JSON.stringify({ source: 'instagram', messageId }),
          },
        });

        console.log(`[Instagram] Lead ${lead.id} — mensagem: ${text.substring(0, 80)}`);

        // ─── Detecção de comprovante de pagamento ────────────────────────────
        if (isImage && imageUrl && client.instagramToken) {
          try {
            // Baixa a imagem e converte para base64
            const imgRes = await fetch(imageUrl);
            const imgBuffer = await imgRes.arrayBuffer();
            const imgBase64 = Buffer.from(imgBuffer).toString('base64');
            const imgMime = imgRes.headers.get('content-type') || 'image/jpeg';

            const receiptResult = await claudeService.analyzePaymentReceipt({
              imageBase64: imgBase64,
              imageMime: imgMime,
              leadName: lead.name,
              productValue: client.productValue,
            });

            if (receiptResult?.isPaymentReceipt) {
              const value = receiptResult.value || client.productValue || null;

              // Marca lead como convertido
              await prisma.lead.update({
                where: { id: lead.id },
                data: { status: 'converted', stage: 'action', value },
              });

              // Salva nota
              await prisma.interaction.create({
                data: {
                  leadId: lead.id,
                  type: 'note',
                  direction: 'inbound',
                  content: `✅ Comprovante de pagamento recebido via Instagram${value ? ` — R$ ${value}` : ''}`,
                  metadata: JSON.stringify({ source: 'instagram', isReceipt: true }),
                },
              });

              // Responde no Instagram
              const replyMsg = receiptResult.reply || `✅ Pagamento confirmado! Muito obrigado 🙏`;
              await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${client.instagramToken}` },
                body: JSON.stringify({ recipient: { id: senderId }, message: { text: replyMsg }, messaging_type: 'RESPONSE' }),
              });

              // Salva resposta
              await prisma.interaction.create({
                data: { leadId: lead.id, type: 'message', direction: 'outbound', content: replyMsg, metadata: JSON.stringify({ source: 'instagram', ai: true }) },
              });

              // Meta Pixel
              if (client.pixelId && client.metaConversionsToken && value) {
                metaConversions.sendPurchaseEvent({ pixelId: client.pixelId, accessToken: client.metaConversionsToken, value, phone: null, email: lead.email, name: lead.name, sourceUrl: client.website }).catch(() => {});
              }

              console.log(`[Instagram] Comprovante detectado — Lead ${lead.id} convertido R$ ${value}`);
              continue; // Não processa mais a mensagem
            }
          } catch (receiptErr) {
            console.error('[Instagram] Erro ao analisar comprovante:', receiptErr.message);
          }
        }

        // AI response if enabled
        if (client.aiEnabled && client.instagramToken) {
          try {
            const history = lead.interactions.map(i => ({
              role: i.direction === 'inbound' ? 'user' : 'assistant',
              content: i.content,
            }));
            history.push({ role: 'user', content: text });

            const aiResult = await claudeService.getAIResponse(history, client);

            if (aiResult?.reply) {
              // Save AI response
              await prisma.interaction.create({
                data: {
                  leadId: lead.id,
                  type: 'message',
                  direction: 'outbound',
                  content: aiResult.reply,
                  metadata: JSON.stringify({ source: 'instagram', ai: true }),
                },
              });

              // Update lead if converted
              if (aiResult.converted) {
                await prisma.lead.update({
                  where: { id: lead.id },
                  data: { status: 'converted', stage: 'action', value: aiResult.conversionValue || null },
                });
              }

              // Send reply via Instagram API
              await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${client.instagramToken}`,
                },
                body: JSON.stringify({
                  recipient: { id: senderId },
                  message: { text: aiResult.reply },
                  messaging_type: 'RESPONSE',
                }),
              });

              console.log(`[Instagram] Resposta IA enviada para lead ${lead.id}`);

              // Price alert
              if (aiResult.needsPriceAlert && client.phone) {
                const leadName = lead.name || senderId;
                const alertMsg = `🔔 *Alerta de Lead — Preço Solicitado*\n\nO lead *${leadName}* (Instagram DM) perguntou sobre o preço e não consegui responder.\n\nResponda manualmente pelo Instagram.`;
                const evolutionService = require('../services/evolutionService');
                evolutionService.sendClientMessage(client.instanceName, client.phone, alertMsg).catch(() => {});
              }
            }
          } catch (aiErr) {
            console.error('[Instagram] Erro IA:', aiErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Instagram] Erro:', err.message);
  }
}

module.exports = { verifyWebhook, receiveMessage };
