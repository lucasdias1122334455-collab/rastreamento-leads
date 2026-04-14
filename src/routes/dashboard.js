const { Router } = require('express');
const { getStats, getMetaStats } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.use(authenticate);
router.get('/stats', getStats);
router.get('/meta-stats', getMetaStats);

module.exports = router;
