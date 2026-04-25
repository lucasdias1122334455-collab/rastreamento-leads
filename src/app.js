const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const interactionRoutes = require('./routes/interactions');
const whatsappRoutes = require('./routes/whatsapp');
const dashboardRoutes = require('./routes/dashboard');
const clientRoutes = require('./routes/clients');
const metaRoutes = require('./routes/meta');
const userRoutes = require('./routes/users');
const conversationsRoutes = require('./routes/conversations');
const mercadoPagoRoutes = require('./routes/mercadopago');
const saleWebhookRoutes = require('./routes/saleWebhook');
const instagramRoutes = require('./routes/instagram');
const aiAnalystRoutes = require('./routes/aiAnalyst');
const tokenUsageRoutes = require('./routes/tokenUsage');
const reportsRoutes = require('./routes/reports');
const trackingRoutes = require('./routes/tracking');
const crmRoutes = require('./routes/crm');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/mp', mercadoPagoRoutes);
app.use('/api/sale', saleWebhookRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/analyst', aiAnalystRoutes);
app.use('/api/tokens', tokenUsageRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/rastrear', trackingRoutes);
app.use('/api/crm', crmRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`[DB] DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 40)}...`);

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  // Cria tabelas se não existirem (PostgreSQL)
  try {
    console.log('[DB] Criando tabelas...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        active BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        notes TEXT,
        "instanceName" TEXT NOT NULL UNIQUE,
        "metaPhoneNumberId" TEXT,
        "metaAccessToken" TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone TEXT NOT NULL UNIQUE,
        email TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        stage TEXT NOT NULL DEFAULT 'awareness',
        notes TEXT,
        tags TEXT,
        "assignedToId" INTEGER REFERENCES users(id),
        "clientId" INTEGER REFERENCES clients(id),
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS interactions (
        id SERIAL PRIMARY KEY,
        "leadId" INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        "userId" INTEGER REFERENCES users(id),
        type TEXT NOT NULL,
        direction TEXT,
        content TEXT NOT NULL,
        metadata TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        id SERIAL PRIMARY KEY,
        "sessionId" TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'disconnected',
        "qrCode" TEXT,
        phone TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS user_clients (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "clientId" INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        UNIQUE("userId", "clientId")
      )
    `);
    // Tabela de investimento por anúncio
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ad_spend (
        id SERIAL PRIMARY KEY,
        "adKey" TEXT NOT NULL,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        amount NUMERIC NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE("adKey", "clientId")
      )
    `);
    // Migrações seguras — adiciona colunas se não existirem
    await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS value NUMERIC DEFAULT NULL`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "metaPhoneNumberId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "metaAccessToken" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "mpAccessToken" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "aiEnabled" BOOLEAN DEFAULT false`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "aiScript" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "productValue" NUMERIC`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "paymentLink" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "website" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "pixelId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "metaConversionsToken" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "brendiClientId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "brendiSecret" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "instagramToken" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "instagramAccountId" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP DEFAULT NULL`);
    // Backfill: preenche convertedAt para leads já convertidos usando updatedAt
    await prisma.$executeRawUnsafe(`UPDATE leads SET "convertedAt" = "updatedAt" WHERE status = 'converted' AND "convertedAt" IS NULL`);
    // Tabela de rastreamento de tokens por cliente (acesso exclusivo Portuga)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id SERIAL PRIMARY KEY,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        "clientName" TEXT,
        feature TEXT NOT NULL,
        "inputTokens" INTEGER NOT NULL DEFAULT 0,
        "outputTokens" INTEGER NOT NULL DEFAULT 0,
        "costUsd" NUMERIC(10,6) NOT NULL DEFAULT 0,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_token_usage_client_date ON token_usage("clientId", date)`);
    // Tabelas de rastreamento de links (UTM tracking)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tracking_links (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        campaign TEXT NOT NULL,
        destination TEXT NOT NULL,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        clicks INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS tracking_clicks (
        id SERIAL PRIMARY KEY,
        "linkId" INTEGER NOT NULL REFERENCES tracking_links(id) ON DELETE CASCADE,
        "clientId" INTEGER,
        campaign TEXT,
        ip TEXT,
        "userAgent" TEXT,
        "clickedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_tracking_clicks_client ON tracking_clicks("clientId", "clickedAt")`);
    // Ricardo — agente de voz
    await prisma.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS "voiceEnabled" BOOLEAN DEFAULT false`);
    // CRM — status do ticket e timestamp de leitura
    await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "crmStatus" TEXT DEFAULT 'new'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS "crmReadAt" TIMESTAMP DEFAULT NULL`);
    // CRM — tarefas
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crm_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        "dueAt" TIMESTAMP DEFAULT NULL,
        completed BOOLEAN NOT NULL DEFAULT false,
        "leadId" INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        "reminderSent" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // CRM — agendamentos
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crm_appointments (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        "scheduledAt" TIMESTAMP DEFAULT NULL,
        notes TEXT,
        "leadId" INTEGER REFERENCES leads(id) ON DELETE SET NULL,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        "detectedBy" TEXT NOT NULL DEFAULT 'manual',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // CRM — respostas rápidas
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crm_quick_replies (
        id SERIAL PRIMARY KEY,
        shortcut TEXT NOT NULL,
        content TEXT NOT NULL,
        "clientId" INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[DB] Tabelas criadas com sucesso.');
  } catch (e) {
    console.error('[DB] Erro ao criar tabelas:', e.message);
  }

  // Cria admin padrão
  try {
    const bcrypt = require('bcryptjs');
    const existing = await prisma.user.findUnique({ where: { email: 'admin@sistema.com' } });
    if (!existing) {
      const hash = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: { name: 'Administrador', email: 'admin@sistema.com', password: hash, role: 'admin' }
      });
      console.log('[DB] Admin criado automaticamente!');
    }
  } catch (e) {
    console.error('[DB] Erro ao criar admin:', e.message);
  }

  await prisma.$disconnect();

  // ─── Task reminder scheduler ─────────────────────────────────────────────────
  // Every 60s: check tasks due in the next 5 min that haven't had reminder sent
  const evolutionSvc = require('./services/evolutionService');
  const dbForScheduler = require('./config/database');
  setInterval(async () => {
    try {
      const due = await dbForScheduler.$queryRawUnsafe(`
        SELECT t.*, l.phone as "leadPhone", l.name as "leadName", c."instanceName"
        FROM crm_tasks t
        LEFT JOIN leads l ON l.id = t."leadId"
        LEFT JOIN clients c ON c.id = t."clientId"
        WHERE t.completed = false
          AND t."reminderSent" = false
          AND t."dueAt" IS NOT NULL
          AND t."dueAt" <= NOW() + INTERVAL '5 minutes'
          AND t."dueAt" >= NOW() - INTERVAL '1 hour'
      `);
      for (const task of due) {
        if (task.instanceName && task.leadPhone) {
          const msg = `⏰ *Lembrete de tarefa:* ${task.title}${task.leadName ? '\n👤 Lead: ' + task.leadName : ''}`;
          try {
            await evolutionSvc.sendClientMessage(task.instanceName, task.leadPhone, msg);
          } catch (_) {}
        }
        await dbForScheduler.$executeRawUnsafe(`UPDATE crm_tasks SET "reminderSent"=true WHERE id=$1`, task.id);
      }
    } catch (_) {}
  }, 60000);

  // ─── Silence follow-up scheduler ─────────────────────────────────────────────
  // Every 6 hours: check leads that sent the last inbound message > X hours ago
  // and haven't received a reply yet. Logs to console (team notified via dashboard).
  // Full auto-send can be enabled per client in future.
  setInterval(async () => {
    try {
      const silent = await dbForScheduler.$queryRawUnsafe(`
        SELECT l.id, l.name, l.phone, l."crmStatus",
               last_i."createdAt" as "lastAt", last_i.direction,
               c."instanceName", c.name as "clientName"
        FROM leads l
        LEFT JOIN clients c ON c.id = l."clientId"
        LEFT JOIN LATERAL (
          SELECT "createdAt", direction FROM interactions
          WHERE "leadId" = l.id ORDER BY "createdAt" DESC LIMIT 1
        ) last_i ON true
        WHERE last_i.direction = 'inbound'
          AND last_i."createdAt" < NOW() - INTERVAL '24 hours'
          AND (l."crmStatus" IS NULL OR l."crmStatus" NOT IN ('resolved'))
          AND l."clientId" IS NOT NULL
      `);
      if (silent.length > 0) {
        console.log(`[CRM] ${silent.length} leads sem resposta há +24h`);
      }
    } catch (_) {}
  }, 6 * 3600000);
});

module.exports = app;