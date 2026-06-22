const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', notificationController.getNotifications);
router.post('/', notificationController.addNotification);
router.delete('/:id', notificationController.removeNotification);

module.exports = router;
