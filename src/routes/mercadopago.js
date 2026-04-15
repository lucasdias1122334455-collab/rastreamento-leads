const express = require('express');
const router = express.Router();
const { webhook } = require('../controllers/mercadoPagoController');

// Webhook por cliente — cada cliente tem sua própria URL
// Ex: https://rastreamento-leads-production.up.railway.app/api/mp/webhook/3
router.post('/webhook/:clientId', webhook);

module.exports = router;
