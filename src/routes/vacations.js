const express = require('express');
const router = express.Router();
const vacationController = require('../controllers/vacationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', vacationController.getVacations);
router.post('/', vacationController.addVacation);
router.put('/:id', vacationController.updateVacation);

module.exports = router;
