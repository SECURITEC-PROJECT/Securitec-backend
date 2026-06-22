const express = require('express');
const router = express.Router();
const accessLogController = require('../controllers/accessLogController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', accessLogController.getAccessLogs);
router.post('/', accessLogController.addAccessLog);

module.exports = router;
