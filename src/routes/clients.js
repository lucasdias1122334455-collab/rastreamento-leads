const { Router } = require('express');
const { listClients, createClient, getClient, updateClient, deleteClient, getClientWhatsAppStatus, getClientLeads } = require('../controllers/clientController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();
router.use(authenticate);

router.get('/', listClients);
router.post('/', requireAdmin, createClient);
router.get('/:id', getClient);
router.put('/:id', requireAdmin, updateClient);
router.delete('/:id', requireAdmin, deleteClient);
router.get('/:id/whatsapp', getClientWhatsAppStatus);
router.get('/:id/leads', getClientLeads);

module.exports = router;
