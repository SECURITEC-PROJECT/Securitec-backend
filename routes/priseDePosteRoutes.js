const express = require('express');
const router = express.Router();
const controller = require('../controllers/PriseDePosteController');

router.get('/shifts', controller.getAllShifts);
router.post('/shifts', controller.createShift);
router.put('/shifts/:id/end', controller.endShift);

module.exports = router;