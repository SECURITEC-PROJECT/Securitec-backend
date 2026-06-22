const express = require('express');
const router = express.Router();
const accessLogController = require('../controllers/accessLogController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', accessLogController.getAccessLogs);
router.post('/', accessLogController.addAccessLog);
router.delete('/:id', accessLogController.removeAccessLog);

module.exports = router;
