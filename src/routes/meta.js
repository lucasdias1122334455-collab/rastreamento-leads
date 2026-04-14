const { Router } = require('express');
const { webhook, verify } = require('../controllers/metaController');

const router = Router();

// Verificação do webhook (GET) + recebimento de mensagens (POST)
router.get('/webhook', verify);
router.post('/webhook', webhook);

module.exports = router;
