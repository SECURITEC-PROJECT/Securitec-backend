const express = require('express');
const router = express.Router();
const cameraController = require('../controllers/cameraController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', cameraController.getCameras);
router.post('/', cameraController.addCamera);
router.put('/:id/status', cameraController.updateCameraStatus);
router.delete('/:id', cameraController.removeCamera);
router.get('/extractions', cameraController.getCameraExtractions);
router.post('/:id/extract', cameraController.extractSequence);

module.exports = router;
