const express = require('express');
const router = express.Router();
const { saleWebhook } = require('../controllers/saleWebhookController');

// Webhook de venda do site — cada cliente tem sua URL
// POST /api/sale/webhook/:clientId
router.post('/webhook/:clientId', saleWebhook);

module.exports = router;
