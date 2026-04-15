const prisma = require('../config/database');

async function getSpend(req, res, next) {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "adKey", "clientId", amount FROM ad_spend`);
    res.json(rows);
  } catch (err) { next(err); }
}

async function setSpend(req, res, next) {
  try {
    const { adKey, clientId, amount } = req.body;
    if (!adKey) return res.status(400).json({ error: 'adKey obrigatório' });

    await prisma.$executeRawUnsafe(
      `INSERT INTO ad_spend ("adKey", "clientId", amount, "updatedAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("adKey", "clientId") DO UPDATE SET amount = $3, "updatedAt" = NOW()`,
      adKey,
      clientId ? Number(clientId) : null,
      Number(amount) || 0
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { getSpend, setSpend };
