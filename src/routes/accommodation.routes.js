const express = require('express');
const router = express.Router();
const accommodationController = require('../controllers/accommodation.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createAccommodationSchema,
  updateAccommodationSchema,
  createRoomSchema,
  updateRoomSchema,
  createServiceSchema,
  updateServiceSchema,
  createBookingSchema,
  updateBookingSchema,
  availableRoomsQuerySchema
} = require('../schemas/accommodation.schema');

// All routes require authentication (except public GET endpoints)
// Public routes (no authentication required)
router.get('/', accommodationController.getAllAccommodations);
router.get('/:id', accommodationController.getAccommodationById);
router.get(
  '/:accommodationId/available-rooms',
  validate(availableRoomsQuerySchema, 'query'),
  accommodationController.getAvailableRooms
);

// All routes below require authentication
router.use(authMiddleware.authenticate);

// ==================== ACCOMMODATION MANAGEMENT ====================

/**
 * Create accommodation
 * Access: SuperAdmin only (for now)
 * POST /api/accommodations
 */
router.post(
  '/',
  validate(createAccommodationSchema),
  accommodationController.createAccommodation
);

/**
 * Update accommodation
 * Access: SuperAdmin only (for now)
 * PUT /api/accommodations/:id
 */
router.put(
  '/:id',
  validate(updateAccommodationSchema),
  accommodationController.updateAccommodation
);

/**
 * Delete accommodation
 * Access: SuperAdmin only (for now)
 * DELETE /api/accommodations/:id
 */
router.delete('/:id', accommodationController.deleteAccommodation);

// ==================== ROOM MANAGEMENT ====================

/**
 * Add room to accommodation
 * Access: SuperAdmin only (for now)
 * POST /api/accommodations/:accommodationId/rooms
 */
router.post(
  '/:accommodationId/rooms',
  validate(createRoomSchema),
  accommodationController.addRoom
);

/**
 * Update room
 * Access: SuperAdmin only (for now)
 * PUT /api/rooms/:roomId
 */
router.put(
  '/rooms/:roomId',
  validate(updateRoomSchema),
  accommodationController.updateRoom
);

/**
 * Delete room
 * Access: SuperAdmin only (for now)
 * DELETE /api/rooms/:roomId
 */
router.delete('/rooms/:roomId', accommodationController.deleteRoom);

// ==================== SERVICE MANAGEMENT ====================

/**
 * Add service to accommodation
 * Access: SuperAdmin only (for now)
 * POST /api/accommodations/:accommodationId/services
 */
router.post(
  '/:accommodationId/services',
  validate(createServiceSchema),
  accommodationController.addService
);

/**
 * Update service
 * Access: SuperAdmin only (for now)
 * PUT /api/services/:serviceId
 */
router.put(
  '/services/:serviceId',
  validate(updateServiceSchema),
  accommodationController.updateService
);

/**
 * Delete service
 * Access: SuperAdmin only (for now)
 * DELETE /api/services/:serviceId
 */
router.delete('/services/:serviceId', accommodationController.deleteService);

// ==================== BOOKING MANAGEMENT ====================

/**
 * Create booking for travel plan
 * Access: TravelPlan Owner/Editor
 * POST /api/travel-plans/:travelPlanId/accommodation-bookings
 */
router.post(
  '/travel-plans/:travelPlanId/accommodation-bookings',
  validate(createBookingSchema),
  accommodationController.createBooking
);

/**
 * Get booking by ID
 * Access: TravelPlan Owner/Editor/Viewer/Suggester
 * GET /api/accommodation-bookings/:bookingId
 */
router.get(
  '/accommodation-bookings/:bookingId',
  accommodationController.getBookingById
);

/**
 * Update booking
 * Access: TravelPlan Owner/Editor
 * PUT /api/accommodation-bookings/:bookingId
 */
router.put(
  '/accommodation-bookings/:bookingId',
  validate(updateBookingSchema),
  accommodationController.updateBooking
);

/**
 * Cancel booking
 * Access: TravelPlan Owner/Editor
 * DELETE /api/accommodation-bookings/:bookingId
 */
router.delete(
  '/accommodation-bookings/:bookingId',
  accommodationController.cancelBooking
);

module.exports = router;