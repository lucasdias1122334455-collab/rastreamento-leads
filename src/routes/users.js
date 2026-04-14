const { Router } = require('express');
const { list, create, update, remove } = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', list);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

module.exports = router;
