const { Router } = require('express');
const { webhook, verify } = require('../controllers/metaController');
const { getSpend, setSpend } = require('../controllers/adSpendController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.get('/webhook', verify);
router.post('/webhook', webhook);
router.get('/spend', authenticate, getSpend);
router.put('/spend', authenticate, setSpend);

module.exports = router;
