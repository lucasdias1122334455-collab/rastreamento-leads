const express = require('express');
const router = express.Router();
const { webhook, testPayment } = require('../controllers/mercadoPagoController');

// Webhook por cliente — cada cliente tem sua própria URL
// Ex: https://rastreamento-leads-production.up.railway.app/api/mp/webhook/3
router.post('/webhook/:clientId', webhook);

// Rota de teste — simula pagamento aprovado sem chamar MP API
// POST /api/mp/test/:clientId  { phone, amount, name }
router.post('/test/:clientId', testPayment);

module.exports = router;
