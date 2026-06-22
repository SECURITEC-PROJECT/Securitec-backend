const express = require('express');
const router = express.Router();
const vacationController = require('../controllers/vacationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', vacationController.getVacations);
router.post('/', vacationController.addVacation);
router.put('/:id', vacationController.updateVacation);
router.delete('/:id', vacationController.deleteVacation);

module.exports = router;
