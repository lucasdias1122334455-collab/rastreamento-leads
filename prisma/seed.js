const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@sistema.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@sistema.com',
      password: passwordHash,
      role: 'admin',
    },
  });

  console.log('Seed concluído:', { admin });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
