const { Router } = require('express');
const { getStats } = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.use(authenticate);
router.get('/stats', getStats);

module.exports = router;
