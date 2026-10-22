const express = require('express');
const router = express.Router();
const shiftController = require('../controllers/priseDePosteController');
const employeeController = require('../controllers/employeeController');

// Routes Prise de Poste
router.get('/shifts', shiftController.getAllShifts);
router.post('/shifts', shiftController.createShift);
router.put('/shifts/:id/end', shiftController.endShift);

// Routes Références & Employés
router.get('/employes/:matricule', employeeController.getEmployeeByMatricule);
router.get('/options-prise-de-poste', employeeController.getFormDataOptions);

module.exports = router;