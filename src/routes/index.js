const express = require('express');
const tripRoutes = require('./tripRoutes');
const authRoutes = require('./authRoutes');
const hotelRoutes = require('./hotelRoutes');
const transportRoutes = require('./transportRoutes');
const storeRoutes = require('./storeRoutes');

const router = express.Router();

// Mount routes
router.use('/trips', tripRoutes);
router.use('/auth', authRoutes);
router.use('/hotels', hotelRoutes);
router.use('/transports', transportRoutes);
router.use('/stores', storeRoutes);

// API documentation
router.get('/', (req, res) => {
  res.json({
    message: 'AI Trip Planner API',
    endpoints: {
      trips: {
        create: 'POST /api/trips',
        getAll: 'GET /api/trips',
        getOne: 'GET /api/trips/:id',
        update: 'PUT /api/trips/:id',
        delete: 'DELETE /api/trips/:id',
        generateAI: 'POST /api/trips/ai/generate'
      },
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login'
      },
      hotels: {
        create: 'POST /api/hotels/trip/:tripId',
        getTripHotels: 'GET /api/hotels/trip/:tripId',
        search: 'GET /api/hotels/search'
      },
      transports: {
        create: 'POST /api/transports/trip/:tripId',
        getTripTransports: 'GET /api/transports/trip/:tripId',
        estimateFare: 'POST /api/transports/estimate'
      },
      stores: {
        create: 'POST /api/stores/trip/:tripId',
        getTripStores: 'GET /api/stores/trip/:tripId',
        recommendations: 'GET /api/stores/recommendations'
      }
    }
  });
});

module.exports = router;