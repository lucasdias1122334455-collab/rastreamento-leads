const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const interactionRoutes = require('./routes/interactions');
const whatsappRoutes = require('./routes/whatsapp');
const dashboardRoutes = require('./routes/dashboard');
const clientRoutes = require('./routes/clients');
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);

  // Garante que as tabelas existam (migrations manuais via SQL)
  try {
    const { PrismaClient } = require('@prisma/client');
    const prismaRaw = new PrismaClient();

    await prismaRaw.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        notes TEXT,
        instanceName TEXT NOT NULL UNIQUE,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await prismaRaw.$executeRawUnsafe(`ALTER TABLE leads ADD COLUMN clientId INTEGER REFERENCES clients(id)`);
    } catch (_) { /* coluna já existe */ }

    console.log('[DB] Tabelas verificadas.');
    await prismaRaw.$disconnect();
  } catch (e) {
    console.error('[DB] Erro ao verificar tabelas:', e.message);
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();
    const existing = await prisma.user.findUnique({ where: { email: 'admin@sistema.com' } });
    if (!existing) {
      const hash = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: { name: 'Administrador', email: 'admin@sistema.com', password: hash, role: 'admin' }
      });
      console.log('Admin criado automaticamente!');
    }
    await prisma.$disconnect();
  } catch (e) {
    console.error('Erro ao criar admin:', e);
  }
});

module.exports = app;