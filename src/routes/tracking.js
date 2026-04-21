const { Router } = require('express');
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = Router();

// ─── PUBLIC: GET /rastrear/:slug ─────────────────────────────────────────────
// Redirect + registra clique
router.get('/:slug', async (req, res) => {
  try {
    const link = await prisma.$queryRawUnsafe(
      `SELECT * FROM tracking_links WHERE slug = $1 LIMIT 1`,
      req.params.slug
    );

    if (!link.length) {
      return res.status(404).send('Link não encontrado');
    }

    const l = link[0];
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    // Registra clique em background (não bloqueia o redirect)
    Promise.all([
      prisma.$executeRawUnsafe(
        `INSERT INTO tracking_clicks ("linkId", "clientId", campaign, ip, "userAgent") VALUES ($1, $2, $3, $4, $5)`,
        l.id, l.clientId, l.campaign, ip, ua
      ),
      prisma.$executeRawUnsafe(
        `UPDATE tracking_links SET clicks = clicks + 1 WHERE id = $1`,
        l.id
      ),
    ]).catch(() => {});

    // Redireciona imediatamente
    res.redirect(302, l.destination);
  } catch (err) {
    console.error('[Tracking]', err.message);
    res.status(500).send('Erro interno');
  }
});

// ─── ADMIN API (requer JWT) ───────────────────────────────────────────────────

// GET /api/tracking/links
router.get('/api/links', authenticate, async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = clientId ? `WHERE tl."clientId" = ${Number(clientId)}` : '';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT tl.*, c.name as "clientName"
      FROM tracking_links tl
      LEFT JOIN clients c ON c.id = tl."clientId"
      ${filter}
      ORDER BY tl."createdAt" DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tracking/links
router.post('/api/links', authenticate, async (req, res) => {
  try {
    const { slug, campaign, destination, clientId } = req.body;
    if (!slug || !campaign || !destination) {
      return res.status(400).json({ error: 'slug, campaign e destination são obrigatórios' });
    }
    // Slug: só letras, números e hífens
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const rows = await prisma.$queryRawUnsafe(
      `INSERT INTO tracking_links (slug, campaign, destination, "clientId")
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      cleanSlug, campaign, destination, clientId ? Number(clientId) : null
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.message.includes('unique')) {
      return res.status(409).json({ error: 'Esse slug já existe. Use outro nome.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tracking/links/:id
router.put('/api/links/:id', authenticate, async (req, res) => {
  try {
    const { campaign, destination, clientId } = req.body;
    if (!campaign || !destination) {
      return res.status(400).json({ error: 'campaign e destination são obrigatórios' });
    }
    const rows = await prisma.$queryRawUnsafe(
      `UPDATE tracking_links SET campaign = $1, destination = $2, "clientId" = $3 WHERE id = $4 RETURNING *`,
      campaign, destination, clientId ? Number(clientId) : null, Number(req.params.id)
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tracking/links/:id
router.delete('/api/links/:id', authenticate, async (req, res) => {
  try {
    await prisma.$executeRawUnsafe(
      `DELETE FROM tracking_links WHERE id = $1`,
      Number(req.params.id)
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
