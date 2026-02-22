const express = require('express');
const router = express.Router();
const transportationController = require('../controllers/transportation.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createProviderSchema,
  updateProviderSchema,
  createVehicleSchema,
  updateVehicleSchema,
  bulkVehiclesSchema,
  createBookingSchema,
  updateBookingSchema,
  updateLocationSchema,
  fareCalculationSchema,
  availableVehiclesQuerySchema,
  vehicleHistoryQuerySchema
} = require('../schemas/transportation.schema');

// ==================== PUBLIC ROUTES ====================

// Get all providers (public)
router.get('/providers', transportationController.getAllProviders);

// Get provider by ID (public)
router.get('/providers/:id', transportationController.getProviderById);

// Get available vehicles (public)
router.get(
  '/providers/:providerId/available-vehicles',
  validate(availableVehiclesQuerySchema, 'query'),
  transportationController.getAvailableVehicles
);

// Calculate fare estimate (public)
router.post(
  '/calculate-fare',
  validate(fareCalculationSchema),
  transportationController.calculateFare
);

// ==================== PROTECTED ROUTES ====================

// All routes below require authentication
router.use(authMiddleware.authenticate);

// ==================== PROVIDER MANAGEMENT ====================

// Create provider (vendors only)
router.post(
  '/providers',
  validate(createProviderSchema),
  transportationController.createProvider
);

// Get vendor's own providers
router.get('/my-providers', transportationController.getMyProviders);

// Update provider (owner/manager)
router.put(
  '/providers/:id',
  validate(updateProviderSchema),
  transportationController.updateProvider
);

// Delete provider (owner only)
router.delete('/providers/:id', transportationController.deleteProvider);

// Get provider statistics (owner/manager)
router.get('/providers/:id/stats', transportationController.getProviderStats);

// ==================== VEHICLE MANAGEMENT ====================

// Add single vehicle
router.post(
  '/providers/:providerId/vehicles',
  validate(createVehicleSchema),
  transportationController.addVehicle
);

// Bulk add vehicles
router.post(
  '/providers/:providerId/vehicles/bulk',
  validate(bulkVehiclesSchema),
  transportationController.bulkAddVehicles
);

// Update vehicle
router.put(
  '/vehicles/:vehicleId',
  validate(updateVehicleSchema),
  transportationController.updateVehicle
);

// Update vehicle location (drivers/vendors)
router.patch(
  '/vehicles/:vehicleId/location',
  validate(updateLocationSchema),
  transportationController.updateVehicleLocation
);

// Delete vehicle
router.delete('/vehicles/:vehicleId', transportationController.deleteVehicle);

// Get vehicle history
router.get(
  '/vehicles/:vehicleId/history',
  validate(vehicleHistoryQuerySchema, 'query'),
  transportationController.getVehicleHistory
);

// ==================== BOOKING MANAGEMENT ====================

// Create booking (travel plan owner/editor)
router.post(
  '/travel-plans/:travelPlanId/transportation-bookings',
  validate(createBookingSchema),
  transportationController.createBooking
);

// Get booking by ID
router.get(
  '/bookings/:bookingId',
  transportationController.getBookingById
);

// Update booking (owner/editor)
router.put(
  '/bookings/:bookingId',
  validate(updateBookingSchema),
  transportationController.updateBooking
);

// Cancel booking (owner/editor)
router.delete(
  '/bookings/:bookingId',
  transportationController.cancelBooking
);

module.exports = router;