const express = require('express');
const router = express.Router();
const hotelController = require('../controllers/hotelController');

// Hotel CRUD operations
router.post('/trip/:tripId', hotelController.createHotel);
router.get('/trip/:tripId', hotelController.getTripHotels);
router.get('/:hotelId', hotelController.getHotelById);
router.put('/:hotelId', hotelController.updateHotel);
router.delete('/:hotelId', hotelController.deleteHotel);

// Search and recommendations
router.get('/search', hotelController.searchHotels);

module.exports = router;