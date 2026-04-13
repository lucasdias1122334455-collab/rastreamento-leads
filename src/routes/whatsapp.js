const { Router } = require('express');
const { getStatus, connect, disconnect, sendMessage } = require('../controllers/whatsappController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

router.use(authenticate);

router.get('/status', getStatus);
router.post('/connect', requireAdmin, connect);
router.post('/disconnect', requireAdmin, disconnect);
router.post('/send', sendMessage);

module.exports = router;
