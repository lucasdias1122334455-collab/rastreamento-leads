const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Lista leads do Brendi (source=website, clientId=6)
  const leads = await prisma.lead.findMany({
    where: { clientId: 6, source: 'website' },
    include: { interactions: { take: 1, orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  console.log('Leads do Brendi encontrados:');
  leads.forEach(l => {
    console.log(`ID: ${l.id} | Phone: ${l.phone} | Name: ${l.name} | Value: ${l.value} | ${l.interactions[0]?.content?.substring(0,60)}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
