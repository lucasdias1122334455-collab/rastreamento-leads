const { Router } = require('express');
const { listByLead, create } = require('../controllers/interactionController');
const { authenticate } = require('../middleware/auth');

const router = Router({ mergeParams: true });

router.use(authenticate);

router.get('/leads/:leadId/interactions', listByLead);
router.post('/leads/:leadId/interactions', create);

module.exports = router;
