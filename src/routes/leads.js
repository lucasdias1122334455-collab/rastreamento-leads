const { Router } = require('express');
const { list, getById, create, update, remove } = require('../controllers/leadController');
const { authenticate } = require('../middleware/auth');

const router = Router();

router.use(authenticate);

router.get('/', list);
router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

module.exports = router;
