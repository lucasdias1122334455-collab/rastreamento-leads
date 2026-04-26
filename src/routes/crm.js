const { Router } = require('express');
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');
const evolutionService = require('../services/evolutionService');

const router = Router();
router.use(authenticate);

// ─── STATS ───────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { clientId } = req.query;
    const cf = clientId ? `AND "clientId" = ${Number(clientId)}` : '';
    const [stats] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN "crmStatus" = 'new' OR "crmStatus" IS NULL THEN 1 ELSE 0 END)::int as novo,
        SUM(CASE WHEN "crmStatus" = 'waiting' THEN 1 ELSE 0 END)::int as aguardando,
        SUM(CASE WHEN "crmStatus" = 'attending' THEN 1 ELSE 0 END)::int as atendendo,
        SUM(CASE WHEN "crmStatus" = 'resolved' THEN 1 ELSE 0 END)::int as resolvido
      FROM leads
      WHERE 1=1 ${cf}
    `);
    res.json(stats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TICKETS ─────────────────────────────────────────────────────────────────
router.get('/tickets', async (req, res) => {
  try {
    const { clientId, crmStatus, search } = req.query;
    const conditions = [];
    if (clientId) conditions.push(`l."clientId" = ${Number(clientId)}`);
    if (crmStatus) conditions.push(`l."crmStatus" = '${crmStatus}'`);
    if (search) conditions.push(`(l.name ILIKE '%${search.replace(/'/g,"''")}%' OR l.phone ILIKE '%${search.replace(/'/g,"''")}%')`);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const tickets = await prisma.$queryRawUnsafe(`
      SELECT
        l.id, l.name, l.phone, l.source, l."crmStatus", l."clientId", l."createdAt", l."updatedAt",
        l.tags, l.birthday, l.profession, l."contractedProduct", l."assignedToId",
        c.name as "clientName",
        u.name as "assignedToName",
        last_i.content as "lastMessage",
        last_i."createdAt" as "lastMessageAt",
        last_i.direction as "lastDirection",
        (SELECT COUNT(*)::int FROM interactions i2
         WHERE i2."leadId" = l.id AND i2.direction = 'inbound'
         AND i2."createdAt" > COALESCE(l."crmReadAt", '1970-01-01')) as unread
      FROM leads l
      LEFT JOIN clients c ON c.id = l."clientId"
      LEFT JOIN users u ON u.id = l."assignedToId"
      LEFT JOIN LATERAL (
        SELECT content, "createdAt", direction FROM interactions
        WHERE "leadId" = l.id ORDER BY "createdAt" DESC LIMIT 1
      ) last_i ON true
      ${where}
      ORDER BY COALESCE(last_i."createdAt", l."createdAt") DESC
      LIMIT 200
    `);
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tickets/:id/status', async (req, res) => {
  try {
    const { crmStatus } = req.body;
    await prisma.$executeRawUnsafe(`UPDATE leads SET "crmStatus"=$1, "updatedAt"=NOW() WHERE id=$2`, crmStatus, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tickets/:id/read', async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(`UPDATE leads SET "crmReadAt"=NOW() WHERE id=$1`, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PERFIL DO LEAD (birthday, profession, contractedProduct, tags) ───────────
router.patch('/tickets/:id/profile', async (req, res) => {
  try {
    const { name, birthday, profession, contractedProduct, tags, notes } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined)              { fields.push(`name=$${idx++}`);                    vals.push(name); }
    if (birthday !== undefined)          { fields.push(`birthday=$${idx++}`);                vals.push(birthday ? new Date(birthday) : null); }
    if (profession !== undefined)        { fields.push(`profession=$${idx++}`);              vals.push(profession); }
    if (contractedProduct !== undefined) { fields.push(`"contractedProduct"=$${idx++}`);    vals.push(contractedProduct); }
    if (tags !== undefined)              { fields.push(`tags=$${idx++}`);                    vals.push(tags); }
    if (notes !== undefined)             { fields.push(`notes=$${idx++}`);                   vals.push(notes); }
    if (!fields.length) return res.json({ ok: true });
    fields.push(`"updatedAt"=NOW()`);
    vals.push(Number(req.params.id));
    await prisma.$executeRawUnsafe(
      `UPDATE leads SET ${fields.join(',')} WHERE id=$${idx}`,
      ...vals
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AUTO-TAG VIA IA ──────────────────────────────────────────────────────────
router.post('/tickets/:id/autotag', async (req, res) => {
  try {
    const [lead] = await prisma.$queryRawUnsafe(
      `SELECT l.*, c."aiScript" FROM leads l LEFT JOIN clients c ON c.id = l."clientId" WHERE l.id = $1`,
      Number(req.params.id)
    );
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // Últimas 20 mensagens da conversa
    const msgs = await prisma.$queryRawUnsafe(
      `SELECT direction, content FROM interactions WHERE "leadId"=$1 ORDER BY "createdAt" DESC LIMIT 20`,
      Number(req.params.id)
    );
    const history = msgs.reverse().map(m => `${m.direction === 'inbound' ? 'Lead' : 'Atendente'}: ${m.content}`).join('\n');

    const Anthropic = require('@anthropic-ai/sdk');
    const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await ai.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Analise esta conversa de vendas e gere até 4 tags curtas (1-3 palavras) em português que descrevem o lead. Retorne APENAS um JSON array de strings, sem explicação.\n\nConversa:\n${history}`
      }]
    });
    let tags = [];
    try {
      const text = resp.content[0].text.trim();
      const match = text.match(/\[.*\]/s);
      if (match) tags = JSON.parse(match[0]);
    } catch (_) {}

    const existingTags = lead.tags ? lead.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const merged = [...new Set([...existingTags, ...tags])].slice(0, 6);
    const tagsStr = merged.join(',');

    await prisma.$executeRawUnsafe(`UPDATE leads SET tags=$1, "updatedAt"=NOW() WHERE id=$2`, tagsStr, Number(req.params.id));
    res.json({ tags: merged });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RELATÓRIO DE PERFORMANCE POR OPERADOR ────────────────────────────────────
router.get('/reports/performance', async (req, res) => {
  try {
    const { clientId, days = 30 } = req.query;
    const cf = clientId ? `AND l."clientId" = ${Number(clientId)}` : '';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        u.id, u.name, u.email,
        COUNT(DISTINCT l.id)::int                                              as tickets,
        COUNT(DISTINCT CASE WHEN l.status='converted' THEN l.id END)::int     as conversions,
        COALESCE(SUM(CASE WHEN l.status='converted' THEN l.value END), 0)::float as revenue,
        COUNT(DISTINCT i.id)::int                                              as messages_sent
      FROM users u
      LEFT JOIN leads l ON l."assignedToId" = u.id
        AND l."createdAt" > NOW() - INTERVAL '${Number(days)} days' ${cf}
      LEFT JOIN interactions i ON i."leadId" = l.id AND i.direction = 'outbound'
      WHERE u.active = true
      GROUP BY u.id, u.name, u.email
      ORDER BY conversions DESC, revenue DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PREVISÃO DE RECEITA ──────────────────────────────────────────────────────
router.get('/reports/forecast', async (req, res) => {
  try {
    const { clientId } = req.query;
    const cf = clientId ? `AND l."clientId" = ${Number(clientId)}` : '';
    // Probabilidade por estágio do funil
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        l.stage,
        COUNT(*)::int as count,
        COALESCE(SUM(l.value), 0)::float as total_value,
        COALESCE(AVG(l.value), 0)::float as avg_value
      FROM leads l
      WHERE l.status NOT IN ('converted','lost','disqualified') ${cf}
      GROUP BY l.stage
    `);
    const probabilities = { awareness: 0.10, interest: 0.30, decision: 0.60, action: 0.85 };
    const forecast = rows.map(r => ({
      ...r,
      probability: probabilities[r.stage] || 0.10,
      weighted: (Number(r.total_value) || Number(r.count) * 100) * (probabilities[r.stage] || 0.10),
    }));
    const totalWeighted = forecast.reduce((s, r) => s + r.weighted, 0);
    res.json({ stages: forecast, totalForecast: totalWeighted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────
router.post('/send', async (req, res) => {
  try {
    const { leadId, message } = req.body;
    const [lead] = await prisma.$queryRawUnsafe(
      `SELECT l.*, c."instanceName" FROM leads l LEFT JOIN clients c ON c.id = l."clientId" WHERE l.id = $1`,
      Number(leadId)
    );
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado' });

    // Salva PRIMEIRO — mensagem aparece no CRM independente do WhatsApp
    await prisma.$executeRawUnsafe(
      `INSERT INTO interactions ("leadId", type, direction, content) VALUES ($1, 'message', 'outbound', $2)`,
      Number(leadId), message
    );
    if (!lead.crmStatus || lead.crmStatus === 'new') {
      await prisma.$executeRawUnsafe(`UPDATE leads SET "crmStatus"='attending' WHERE id=$1`, Number(leadId));
    }

    // Tenta enviar pelo WhatsApp (falha silenciosa se instância offline)
    if (lead.instanceName) {
      try {
        await evolutionService.sendClientMessage(lead.instanceName, lead.phone, message);
      } catch (sendErr) {
        console.warn(`[CRM] Falha ao enviar WA para ${lead.phone}:`, sendErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TASKS ───────────────────────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
  try {
    const { clientId, leadId, completed } = req.query;
    const conditions = [];
    if (clientId) conditions.push(`t."clientId" = ${Number(clientId)}`);
    if (leadId) conditions.push(`t."leadId" = ${Number(leadId)}`);
    if (completed !== undefined) conditions.push(`t.completed = ${completed === 'true'}`);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const tasks = await prisma.$queryRawUnsafe(`
      SELECT t.*, l.name as "leadName", l.phone as "leadPhone"
      FROM crm_tasks t LEFT JOIN leads l ON l.id = t."leadId"
      ${where} ORDER BY t."dueAt" ASC NULLS LAST, t."createdAt" DESC
    `);
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tasks', async (req, res) => {
  try {
    const { title, description, dueAt, leadId, clientId } = req.body;
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO crm_tasks (title, description, "dueAt", "leadId", "clientId") VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      title, description || null, dueAt ? new Date(dueAt) : null,
      leadId ? Number(leadId) : null, clientId ? Number(clientId) : null
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/tasks/:id', async (req, res) => {
  try {
    const { title, description, dueAt, completed } = req.body;
    await prisma.$executeRawUnsafe(
      `UPDATE crm_tasks SET title=$1, description=$2, "dueAt"=$3, completed=$4 WHERE id=$5`,
      title, description || null, dueAt ? new Date(dueAt) : null, !!completed, Number(req.params.id)
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM crm_tasks WHERE id=$1`, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────────────────
router.get('/appointments', async (req, res) => {
  try {
    const { clientId, leadId, status, since } = req.query;
    const conditions = [];
    if (clientId) conditions.push(`a."clientId" = ${Number(clientId)}`);
    if (leadId) conditions.push(`a."leadId" = ${Number(leadId)}`);
    if (status) conditions.push(`a.status = '${status}'`);
    else conditions.push(`a.status != 'cancelled'`); // por padrão não mostra cancelados
    if (since) conditions.push(`a."updatedAt" > '${new Date(since).toISOString()}'`);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const appts = await prisma.$queryRawUnsafe(`
      SELECT a.*, l.name as "leadName", l.phone as "leadPhone"
      FROM crm_appointments a LEFT JOIN leads l ON l.id = a."leadId"
      ${where} ORDER BY a."scheduledAt" ASC
    `);
    res.json(appts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/appointments', async (req, res) => {
  try {
    const { title, scheduledAt, notes, leadId, clientId, detectedBy } = req.body;
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO crm_appointments (title, "scheduledAt", notes, "leadId", "clientId", "detectedBy", status) VALUES ($1,$2,$3,$4,$5,$6,'confirmed') RETURNING *`,
      title, scheduledAt ? new Date(scheduledAt) : null, notes || null,
      leadId ? Number(leadId) : null, clientId ? Number(clientId) : null, detectedBy || 'manual'
    );
    const appt = rows[0];

    // Mensagem automática para o lead confirmando o agendamento
    if (leadId && scheduledAt) {
      try {
        const [lead] = await prisma.$queryRawUnsafe(
          `SELECT l.*, c."instanceName" FROM leads l LEFT JOIN clients c ON c.id = l."clientId" WHERE l.id = $1`,
          Number(leadId)
        );
        if (lead && lead.instanceName && lead.phone) {
          const dt = new Date(scheduledAt);
          const dtStr = dt.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
          const leadName = lead.name ? lead.name.split(' ')[0] : 'olá';
          const msg = `Olá ${leadName}! Seu agendamento foi confirmado:\n\n*${title || 'Reunião'}*\n${dtStr}${notes ? `\n\n${notes}` : ''}\n\nQualquer dúvida é só falar!`;
          await evolutionService.sendClientMessage(lead.instanceName, lead.phone, msg);
          // Salva a mensagem no histórico do lead
          await prisma.$executeRawUnsafe(
            `INSERT INTO interactions ("leadId", type, direction, content) VALUES ($1, 'message', 'outbound', $2)`,
            Number(leadId), msg
          );
        }
      } catch (notifErr) {
        console.warn('[CRM] Falha ao notificar lead sobre agendamento:', notifErr.message);
      }
    }

    res.json(appt);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Atualiza status de um agendamento (confirmed / cancelled / rescheduled)
router.patch('/appointments/:id/status', async (req, res) => {
  try {
    const { status, scheduledAt, notes } = req.body;
    let updatedAppt;
    if (scheduledAt) {
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE crm_appointments SET status=$1, "scheduledAt"=$2, notes=COALESCE($3,notes), "updatedAt"=NOW() WHERE id=$4 RETURNING *`,
        status, new Date(scheduledAt), notes || null, Number(req.params.id)
      );
      updatedAppt = rows[0];
    } else {
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE crm_appointments SET status=$1, notes=COALESCE($2,notes), "updatedAt"=NOW() WHERE id=$3 RETURNING *`,
        status, notes || null, Number(req.params.id)
      );
      updatedAppt = rows[0];
    }

    // Mensagem automática ao lead sobre cancelamento ou reagendamento
    if (updatedAppt && updatedAppt.leadId) {
      try {
        const [lead] = await prisma.$queryRawUnsafe(
          `SELECT l.*, c."instanceName" FROM leads l LEFT JOIN clients c ON c.id = l."clientId" WHERE l.id = $1`,
          Number(updatedAppt.leadId)
        );
        if (lead && lead.instanceName && lead.phone) {
          const leadName = lead.name ? lead.name.split(' ')[0] : 'olá';
          let msg = '';
          if (status === 'cancelled') {
            msg = `Olá ${leadName}, seu agendamento *${updatedAppt.title || 'Reunião'}* foi cancelado.${notes ? `\n\nMotivo: ${notes}` : ''}\n\nQualquer dúvida é só falar!`;
          } else if (status === 'confirmed' && scheduledAt) {
            const dt = new Date(scheduledAt);
            const dtStr = dt.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            msg = `Olá ${leadName}! Seu agendamento foi *reagendado*:\n\n*${updatedAppt.title || 'Reunião'}*\n${dtStr}${notes ? `\n\n${notes}` : ''}\n\nQualquer dúvida é só falar!`;
          }
          if (msg) {
            await evolutionService.sendClientMessage(lead.instanceName, lead.phone, msg);
            await prisma.$executeRawUnsafe(
              `INSERT INTO interactions ("leadId", type, direction, content) VALUES ($1, 'message', 'outbound', $2)`,
              Number(updatedAppt.leadId), msg
            );
          }
        }
      } catch (notifErr) {
        console.warn('[CRM] Falha ao notificar lead sobre alteração de agendamento:', notifErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Contagem de agendamentos novos/alterados desde timestamp (para notificações)
router.get('/appointments/notify', async (req, res) => {
  try {
    const { clientId, since } = req.query;
    if (!since) return res.json({ count: 0, items: [] });
    const cf = clientId ? `AND a."clientId" = ${Number(clientId)}` : '';
    const items = await prisma.$queryRawUnsafe(`
      SELECT a.id, a.title, a.status, a."scheduledAt", a."updatedAt", l.name as "leadName"
      FROM crm_appointments a LEFT JOIN leads l ON l.id = a."leadId"
      WHERE a."updatedAt" > $1 ${cf}
      ORDER BY a."updatedAt" DESC LIMIT 20
    `, new Date(since));
    res.json({ count: items.length, items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/appointments/:id', async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM crm_appointments WHERE id=$1`, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── QUICK REPLIES ────────────────────────────────────────────────────────────
router.get('/quick-replies', async (req, res) => {
  try {
    const { clientId } = req.query;
    const where = clientId ? `WHERE "clientId" = ${Number(clientId)} OR "clientId" IS NULL` : '';
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM crm_quick_replies ${where} ORDER BY shortcut`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/quick-replies', async (req, res) => {
  try {
    const { shortcut, content, clientId } = req.body;
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO crm_quick_replies (shortcut, content, "clientId") VALUES ($1,$2,$3) RETURNING *`,
      shortcut, content, clientId ? Number(clientId) : null
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/quick-replies/:id', async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM crm_quick_replies WHERE id=$1`, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PROFILE PICTURE ──────────────────────────────────────────────────────────
router.get('/profile-pic/:leadId', async (req, res) => {
  try {
    const [lead] = await prisma.$queryRawUnsafe(
      `SELECT l.phone, c."instanceName" FROM leads l LEFT JOIN clients c ON c.id = l."clientId" WHERE l.id = $1`,
      Number(req.params.leadId)
    );
    if (!lead || !lead.instanceName || !lead.phone) return res.json({ url: null });
    const url = await evolutionService.fetchProfilePicture(lead.instanceName, lead.phone);
    res.json({ url });
  } catch (_) { res.json({ url: null }); }
});

// ─── MESSAGES for a lead ──────────────────────────────────────────────────────
router.get('/messages/:leadId', async (req, res) => {
  try {
    const msgs = await prisma.$queryRawUnsafe(`
      SELECT id, type, direction, content, "createdAt"
      FROM interactions WHERE "leadId" = $1
      ORDER BY "createdAt" ASC LIMIT 200
    `, Number(req.params.leadId));
    res.json(msgs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
