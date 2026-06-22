const express = require('express');
const router = express.Router();
const consigneController = require('../controllers/consigneController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', consigneController.getConsignes);
router.post('/', consigneController.addConsigne);
router.put('/:id/read', consigneController.markAsRead);

module.exports = router;
