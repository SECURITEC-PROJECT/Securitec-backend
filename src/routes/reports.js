const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authMiddleware, requireRole } = require('../middlewares/authMiddleware');

router.use(authMiddleware, requireRole('supervisor'));

router.get('/audit', reportController.getAuditEvents);
router.get('/archives', reportController.getArchives);

module.exports = router;
