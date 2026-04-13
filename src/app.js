app.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  
  // Auto-seed: cria admin se não existir
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