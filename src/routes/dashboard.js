const { Router } = require('express');
const { getStats, getMetaStats, getConversionValues, getFunnelStats, exportLeads } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.use(authenticate);
router.get('/stats', getStats);
router.get('/meta-stats', getMetaStats);
router.get('/conversion-values', getConversionValues);
router.get('/funnel', getFunnelStats);
router.get('/export-leads', exportLeads);

module.exports = router;
