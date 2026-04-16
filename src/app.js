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
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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
});

module.exports = app;