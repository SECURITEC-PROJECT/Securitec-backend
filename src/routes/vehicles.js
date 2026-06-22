const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', vehicleController.getVehicles);
router.post('/', vehicleController.addVehicle);
router.put('/:id', vehicleController.updateVehicle);
router.delete('/:id', vehicleController.removeVehicle);

module.exports = router;
