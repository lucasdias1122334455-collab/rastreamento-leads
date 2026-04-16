const express = require('express');
const router = express.Router();
const { verifyWebhook, receiveMessage } = require('../controllers/instagramController');

router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveMessage);

module.exports = router;
