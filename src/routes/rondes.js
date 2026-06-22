const express = require('express');
const router = express.Router();
const rondeController = require('../controllers/rondeController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', rondeController.getRondes);
router.post('/', rondeController.addRonde);
router.put('/:id', rondeController.updateRonde);
router.put('/checkpoint/:cpId', rondeController.updateCheckpoint);

module.exports = router;
