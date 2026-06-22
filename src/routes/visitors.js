const express = require('express');
const router = express.Router();
const visitorController = require('../controllers/visitorController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', visitorController.getVisitors);
router.post('/', visitorController.addVisitor);
router.put('/:id', visitorController.updateVisitor);
router.delete('/:id', visitorController.removeVisitor);

module.exports = router;
