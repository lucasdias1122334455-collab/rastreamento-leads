const { Router } = require('express');
const { login, me, updateProfile } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, me);
router.put('/profile', authenticate, updateProfile);

router.post('/setup', async (req, res) => {
  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash('admin123', 10);
    const user = await prisma.user.upsert({
      where: { email: 'admin@sistema.com' },
      update: {},
      create: { name: 'Administrador', email: 'admin@sistema.com', password: hash, role: 'admin' }
    });
    res.json({ ok: true, user: user.email });
  } catch(e) {
    res.json({ error: e.message });
  } finally {
    await prisma.$disconnect();
  }
});

module.exports = router;