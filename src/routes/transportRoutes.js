const express = require('express');
const router = express.Router();
const transportController = require('../controllers/transportController');

// Transport CRUD operations
router.post('/trip/:tripId', transportController.createTransport);
router.get('/trip/:tripId', transportController.getTripTransports);
router.get('/:transportId', transportController.getTransportById);
router.put('/:transportId', transportController.updateTransport);
router.delete('/:transportId', transportController.deleteTransport);

// Status updates and estimates
router.patch('/:transportId/status', transportController.updateTransportStatus);
router.post('/estimate', transportController.estimateFare);

module.exports = router;