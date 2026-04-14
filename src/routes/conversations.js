const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { getAdGroups, getLeadsByAd, getConversation } = require('../controllers/conversationsController');

router.get('/ads', authenticate, getAdGroups);
router.get('/leads', authenticate, getLeadsByAd);
router.get('/lead/:id', authenticate, getConversation);

module.exports = router;
