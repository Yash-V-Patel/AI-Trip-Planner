const express = require('express');
const router = express.Router();
const storeController = require('../controllers/storeController');

// Store CRUD operations
router.post('/trip/:tripId', storeController.createStore);
router.get('/trip/:tripId', storeController.getTripStores);
router.get('/:storeId', storeController.getStoreById);
router.put('/:storeId', storeController.updateStore);
router.delete('/:storeId', storeController.deleteStore);

// Store visit updates and recommendations
router.patch('/:storeId/visit', storeController.updateStoreVisit);
router.get('/recommendations', storeController.getStoreRecommendations);

module.exports = router;