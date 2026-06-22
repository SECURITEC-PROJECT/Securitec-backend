const express = require('express');
const router = express.Router();
const cameraController = require('../controllers/cameraController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', cameraController.getCameras);
router.put('/:id/status', cameraController.updateCameraStatus);

module.exports = router;
