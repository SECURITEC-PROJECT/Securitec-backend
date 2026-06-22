const express = require('express');
const router = express.Router();
const personController = require('../controllers/personController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', personController.getPersons);
router.post('/', personController.addPerson);
router.put('/:id', personController.updatePerson);
router.delete('/:id', personController.removePerson);

module.exports = router;
