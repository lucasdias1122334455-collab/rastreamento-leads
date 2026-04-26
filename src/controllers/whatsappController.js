const evolutionService = require('../services/evolutionService');
const claudeService = require('../services/claudeService');
const metaConversions = require('../services/metaConversionsService');
const prisma = require('../config/database');
const OpenAI = require('openai');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

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
    const isGroup = jid.endsWith('@g.us');

    // Identifica o cliente pela instância
    let client = null;
    if (instance) {
      client = await prisma.client.findUnique({ where: { instanceName: instance } });
    }
    const clientId = client?.id || null;

    // ─── GRUPO WhatsApp ───────────────────────────────────────────────────────
    if (isGroup) {
      const groupId = jid.replace('@g.us', '');
      const groupPhone = `grp_${groupId}`;
      const participant = (data.key?.participant || '').replace('@s.whatsapp.net', '');
      const senderName = data.pushName || participant || 'Desconhecido';

      const content =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage ? '[imagem]' : '[mídia]';

      // Busca ou cria lead do grupo
      let groupLead = await prisma.lead.findFirst({ where: { phone: groupPhone, clientId: clientId || undefined } });
      if (!groupLead) {
        // Tenta buscar nome do grupo via Evolution
        let groupName = null;
        if (instance) {
          try { groupName = await evolutionService.getGroupInfo(instance, jid); } catch (_) {}
        }
        groupLead = await prisma.lead.create({
          data: {
            phone: groupPhone,
            name: groupName || `Grupo ${groupId.substring(0, 12)}`,
            source: 'whatsapp_group',
            status: 'new',
            stage: 'awareness',
            clientId,
          },
        });
        console.log(`[Webhook] Grupo criado: ${groupLead.name}`);
      }

      // Salva mensagem com prefixo do remetente
      await prisma.interaction.create({
        data: {
          leadId: groupLead.id,
          type: 'message',
          direction: 'inbound',
          content,
          metadata: JSON.stringify({ source: 'whatsapp_group', participant, participantName: senderName, groupJid: jid }),
        },
      });

      console.log(`[Webhook] Grupo ${groupLead.name} — ${senderName}: ${content?.substring(0, 60)}`);
      return; // grupos não recebem IA
    }

    // ─── CONTATO INDIVIDUAL ───────────────────────────────────────────────────
    const phone = jid.replace('@s.whatsapp.net', '');
    const pushName = data.pushName || null;

    // Detecta tipo de mensagem
    const isImage = !!(data.message?.imageMessage);
    const isAudio = !!(data.message?.audioMessage);
    const content =
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      (isImage ? '[imagem]' : isAudio ? '[áudio]' : '[mídia]');

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

    // Busca ou cria o lead
    let lead = await prisma.lead.findUnique({ where: { phone } });
    if (!lead) {
      // Rodízio de atendimento: distribui entre operadores do cliente
      let assignedToId = null;
      if (client && client.rotationEnabled) {
        try {
          const operators = await prisma.$queryRawUnsafe(
            `SELECT u.id FROM users u INNER JOIN user_clients uc ON uc."userId"=u.id WHERE uc."clientId"=$1 AND u.active=true ORDER BY u.id`,
            Number(clientId)
          );
          if (operators.length > 0) {
            const idx = (Number(client.rotationIndex || 0)) % operators.length;
            assignedToId = operators[idx].id;
            await prisma.$executeRawUnsafe(
              `UPDATE clients SET "rotationIndex"=$1 WHERE id=$2`,
              (idx + 1) % operators.length, Number(clientId)
            );
          }
        } catch (_) {}
      }
      lead = await prisma.lead.create({
        data: { phone, name: pushName, source: 'whatsapp', status: 'new', stage: 'awareness', clientId, ...(assignedToId ? { assignedToId } : {}) },
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
      } else if (isAudio && client.voiceEnabled) {
        // Áudio recebido — Ricardo transcreve + responde em voz
        await runAudioAgent({ lead, client, instance, messageKey: data.key });
      } else if (content !== '[mídia]' && content !== '[áudio]') {
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
      clientId: client.id || null,
      clientName: client.name || 'Desconhecido',
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

    // ─── AGENDAMENTOS AUTOMÁTICOS ─────────────────────────────────────────────
    if (result.appointmentAction && client) {
      try {
        const leadName = lead.name || lead.phone;
        const action = result.appointmentAction;
        const apptData = result.appointmentData || {};

        if (action === 'create' && apptData.scheduledAt) {
          // Cria novo agendamento
          const [newAppt] = await prisma.$queryRawUnsafe(
            `INSERT INTO crm_appointments (title, "scheduledAt", notes, "leadId", "clientId", "detectedBy", status)
             VALUES ($1, $2, $3, $4, $5, 'ai', 'confirmed') RETURNING *`,
            apptData.title || 'Agendamento',
            new Date(apptData.scheduledAt),
            apptData.notes || null,
            lead.id,
            client.id
          );
          console.log(`[AI] Agendamento criado: ${apptData.title} em ${apptData.scheduledAt}`);

          // Notifica o responsável
          if (client.phone && instance) {
            const dt = new Date(apptData.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
            const notifMsg = `*Novo Agendamento*\n\nLead: ${leadName}\nTipo: ${apptData.title || 'Agendamento'}\nData: ${dt}\n${apptData.notes ? 'Obs: ' + apptData.notes : ''}\n\nAcesse o CRM para mais detalhes.`;
            await evolutionService.sendClientMessage(instance, client.phone, notifMsg).catch(() => {});
          }

        } else if (action === 'reschedule' && apptData.scheduledAt) {
          // Encontra o agendamento mais recente desse lead (não cancelado)
          const [existing] = await prisma.$queryRawUnsafe(
            `SELECT id, title FROM crm_appointments WHERE "leadId" = $1 AND status != 'cancelled' ORDER BY "scheduledAt" DESC LIMIT 1`,
            lead.id
          );
          if (existing) {
            await prisma.$executeRawUnsafe(
              `UPDATE crm_appointments SET "scheduledAt"=$1, notes=$2, status='confirmed', "updatedAt"=NOW() WHERE id=$3`,
              new Date(apptData.scheduledAt),
              apptData.notes || null,
              existing.id
            );
            console.log(`[AI] Agendamento ${existing.id} remarcado para ${apptData.scheduledAt}`);

            if (client.phone && instance) {
              const dt = new Date(apptData.scheduledAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
              const notifMsg = `*Reagendamento*\n\nLead: ${leadName}\nTipo: ${existing.title}\nNova data: ${dt}\n${apptData.notes ? 'Motivo: ' + apptData.notes : ''}\n\nAcesse o CRM para confirmar.`;
              await evolutionService.sendClientMessage(instance, client.phone, notifMsg).catch(() => {});
            }
          }

        } else if (action === 'cancel') {
          // Cancela o agendamento mais recente
          const [existing] = await prisma.$queryRawUnsafe(
            `SELECT id, title, "scheduledAt" FROM crm_appointments WHERE "leadId" = $1 AND status != 'cancelled' ORDER BY "scheduledAt" DESC LIMIT 1`,
            lead.id
          );
          if (existing) {
            await prisma.$executeRawUnsafe(
              `UPDATE crm_appointments SET status='cancelled', notes=COALESCE($1, notes), "updatedAt"=NOW() WHERE id=$2`,
              apptData.notes || null,
              existing.id
            );
            console.log(`[AI] Agendamento ${existing.id} cancelado`);

            if (client.phone && instance) {
              const notifMsg = `*Cancelamento*\n\nLead: ${leadName} cancelou o agendamento.\nTipo: ${existing.title}\n${apptData.notes ? 'Motivo: ' + apptData.notes : ''}\n\nAcesse o CRM para ver detalhes.`;
              await evolutionService.sendClientMessage(instance, client.phone, notifMsg).catch(() => {});
            }
          }
        }
      } catch (apptErr) {
        console.error('[AI] Erro ao processar agendamento:', apptErr.message);
      }
    }

    // Alerta de preço → manda WhatsApp pro responsável do cliente
    if (result.needsPriceAlert && client.phone && instance) {
      try {
        const leadName = lead.name || lead.phone;
        const alertMsg =
          `*Alerta de Lead — Preço Solicitado*\n\nO lead ${leadName} (${lead.phone}) perguntou sobre o preço de um produto.\n\nAcesse o CRM e responda para não perder a venda.`;
        await evolutionService.sendClientMessage(instance, client.phone, alertMsg);
        console.log(`[AI] Alerta de preço enviado para cliente ${client.phone}`);
      } catch (alertErr) {
        console.error('[AI] Erro ao enviar alerta de preço:', alertErr.message);
      }
    }

    // Conversão detectada pela IA — salva valor e marca como convertido
    if (result.converted && lead.status !== 'converted') {
      const saleValue = result.conversionValue
        ? parseFloat(result.conversionValue)
        : client.productValue
        ? parseFloat(client.productValue)
        : null;

      const isValueValid = saleValue && !isNaN(saleValue) && saleValue > 0;

      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          stage: 'action',
          ...(isValueValid ? { value: saleValue, convertedAt: new Date() } : {}),
        },
      });

      const valueStr = isValueValid ? `R$ ${saleValue.toFixed(2)}` : 'valor não identificado';
      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'note',
          direction: 'outbound',
          content: `Venda confirmada — ${valueStr} — Convertido automaticamente pela IA`,
          metadata: JSON.stringify({ ai: true, converted: true, value: isValueValid ? saleValue : null }),
        },
      });

      // Notifica o responsável com o valor
      if (client.phone && instance && isValueValid) {
        const leadName = lead.name || lead.phone;
        const notifMsg = `*Venda Confirmada*\n\nLead: ${leadName}\nValor: R$ ${saleValue.toFixed(2)}\n\nAcesse o CRM para ver os detalhes.`;
        await evolutionService.sendClientMessage(instance, client.phone, notifMsg).catch(() => {});
      }

      // Dispara Pixel se configurado
      if (client.pixelId && client.metaConversionsToken && isValueValid) {
        try {
          const metaConversions = require('../services/metaConversionsService');
          await metaConversions.sendPurchaseEvent({
            pixelId: client.pixelId,
            accessToken: client.metaConversionsToken,
            value: saleValue,
            currency: 'BRL',
            phone: lead.phone,
            email: lead.email,
            clientWebsite: client.website,
          });
        } catch (_) {}
      }

      console.log(`[AI] Lead ${lead.phone} CONVERTIDO — ${valueStr}`);
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
      clientId: client.id || null,
      clientName: client.name || 'Desconhecido',
    });

    if (!result) return;

    if (result.isPaymentReceipt) {
      // Valor extraído da imagem — fallback para productValue se não legível
      const receiptValue = result.value && result.value > 0
        ? result.value
        : client.productValue ? parseFloat(client.productValue) : null;

      const isValueValid = receiptValue && !isNaN(receiptValue) && receiptValue > 0;
      const valueStr = isValueValid ? `R$ ${receiptValue.toFixed(2)}` : 'valor não identificado';

      // Marca como convertido com valor e timestamp
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          stage: 'action',
          convertedAt: new Date(),
          ...(isValueValid ? { value: receiptValue } : {}),
        },
      });

      await prisma.interaction.create({
        data: {
          leadId: lead.id,
          type: 'note',
          direction: 'outbound',
          content: `Comprovante recebido — ${valueStr} — Convertido automaticamente`,
          metadata: JSON.stringify({ ai: true, receipt: true, value: isValueValid ? receiptValue : null }),
        },
      });

      console.log(`[AI] Lead ${lead.phone} CONVERTIDO via comprovante — ${valueStr}`);

      // Notifica o responsável (cliente do sistema)
      if (client.phone && instance) {
        const leadName = lead.name || lead.phone;
        const notifMsg = `*Comprovante Recebido*\n\nLead: ${leadName}\nValor: ${valueStr}\n\nPagamento confirmado automaticamente.`;
        await evolutionService.sendClientMessage(instance, client.phone, notifMsg).catch(() => {});
      }

      // Dispara evento Purchase no Meta Pixel se configurado
      if (client.pixelId && client.metaConversionsToken && isValueValid) {
        metaConversions.sendPurchaseEvent({
          pixelId: client.pixelId,
          accessToken: client.metaConversionsToken,
          value: receiptValue,
          phone: lead.phone,
          email: lead.email,
          name: lead.name,
          sourceUrl: client.website,
        }).catch(() => {});
      }

      // Responde ao lead confirmando o recebimento
      if (result.reply) {
        await evolutionService.sendClientMessage(instance, lead.phone, result.reply).catch(() => {});
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
      await evolutionService.sendClientMessage(instance, lead.phone, result.reply).catch(() => {});
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

// ─── Agente Ricardo (áudio → Whisper → Claude → TTS → nota de voz) ───────────
async function runAudioAgent({ lead, client, instance, messageKey }) {
  try {
    if (!openai) { console.warn('[Ricardo] OPENAI_API_KEY não configurada.'); return; }

    // 1. Baixa o áudio em base64 via Evolution
    const audioBase64 = await evolutionService.getMediaBase64(instance, messageKey);
    if (!audioBase64) return;

    // 2. Transcreve com Whisper
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const audioFile = new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'pt',
    });

    const transcribedText = transcription.text?.trim();
    if (!transcribedText) return;

    console.log(`[Ricardo] Transcrição de ${lead.phone}: ${transcribedText}`);

    // Salva a transcrição como mensagem de entrada
    await prisma.interaction.update({
      where: {
        id: (await prisma.interaction.findFirst({
          where: { leadId: lead.id, direction: 'inbound', content: '[áudio]' },
          orderBy: { createdAt: 'desc' },
        }))?.id,
      },
      data: { content: `[áudio] ${transcribedText}` },
    }).catch(() => {});

    // 3. Gera resposta com Claude (usando persona Ricardo)
    const messages = await prisma.interaction.findMany({
      where: { leadId: lead.id, type: 'message' },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    const ricardoScript = `Você é Ricardo, especialista em vendas e atendimento ao cliente com 15 anos de experiência.
Domina tanto a arte de vender quanto de resolver problemas e fidelizar clientes.
Atendimento humanizado, caloroso e consultivo. Adapta-se a qualquer nicho e situação.
Se o cliente tiver dúvida, resolva. Se tiver interesse, converta. Se tiver problema, acolha.
Fale de forma natural, como em uma conversa de voz — sem listas, sem markdown.
${client.aiScript ? `\n\nRoteiro do cliente:\n${client.aiScript}` : ''}`;

    const result = await claudeService.analyzeConversation({
      leadName: lead.name,
      messages: [...messages.slice(0, -1), { ...messages[messages.length - 1], content: transcribedText }],
      clientScript: ricardoScript,
      productValue: client.productValue || null,
      paymentLink: client.paymentLink || null,
      clientId: client.id || null,
      clientName: client.name || 'Desconhecido',
    });

    if (!result?.reply) return;

    // 4. Converte resposta em áudio com TTS
    const ttsResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx', // voz masculina, profissional
      input: result.reply,
      response_format: 'mp3',
    });

    const replyAudioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    const replyAudioBase64 = replyAudioBuffer.toString('base64');

    // 5. Salva resposta no banco
    await prisma.interaction.create({
      data: {
        leadId: lead.id,
        type: 'message',
        direction: 'outbound',
        content: `[áudio] ${result.reply}`,
        metadata: JSON.stringify({ ai: true, ricardo: true }),
      },
    });

    // 6. Envia como nota de voz no WhatsApp
    try {
      await evolutionService.sendAudioMessage(instance, lead.phone, replyAudioBase64);
    } catch (sendErr) {
      console.warn(`[Ricardo] Falha ao enviar áudio para ${lead.phone}:`, sendErr.message);
      // Fallback: envia como texto
      await evolutionService.sendClientMessage(instance, lead.phone, result.reply);
    }

    console.log(`[Ricardo] Respondeu em áudio para ${lead.phone}`);

  } catch (err) {
    console.error('[Ricardo Audio Agent] Erro:', err.message);
  }
}

module.exports = { getStatus, connect, disconnect, sendMessage, webhook };
