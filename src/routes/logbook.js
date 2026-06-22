const express = require('express');
const router = express.Router();
const logbookController = require('../controllers/logbookController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', logbookController.getLogs);
router.post('/', logbookController.addLog);
router.delete('/:id', logbookController.removeLog);

module.exports = router;
