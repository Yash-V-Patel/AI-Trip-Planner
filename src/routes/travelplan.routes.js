const express = require('express');
const router = express.Router();
const travelPlanController = require('../controllers/travelplan.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createTravelPlanSchema,
  updateTravelPlanSchema,
  sharePlanSchema,
  generateItinerarySchema,
  duplicatePlanSchema,
  updateBudgetSchema,
  accommodationBookingSchema,
  updateAccommodationBookingSchema,
  transportationBookingSchema,
  updateTransportationBookingSchema,
  packageBookingSchema,
  updatePackageBookingSchema,
  experienceBookingSchema,
  updateExperienceBookingSchema,
  shoppingVisitSchema,
  updateShoppingVisitSchema,
  travelExperienceSchema,
  updateTravelExperienceSchema,
  exportQuerySchema
} = require('../schemas/travelplan.schema');

// All travel plan routes require authentication
router.use(authMiddleware.authenticate);

// ==================== CORE TRAVEL PLAN ROUTES ====================

/**
 * Create a new travel plan
 * POST /api/travel-plans
 */
router.post(
  '/',
  validate(createTravelPlanSchema),
  travelPlanController.createTravelPlan
);

/**
 * Get all travel plans for current user
 * GET /api/travel-plans
 */
router.get('/', travelPlanController.getTravelPlans);

/**
 * Get travel plan by ID
 * GET /api/travel-plans/:id
 */
router.get('/:id', travelPlanController.getTravelPlanById);

/**
 * Update travel plan
 * PUT /api/travel-plans/:id
 */
router.put(
  '/:id',
  validate(updateTravelPlanSchema),
  travelPlanController.updateTravelPlan
);

/**
 * Delete travel plan
 * DELETE /api/travel-plans/:id
 */
router.delete('/:id', travelPlanController.deleteTravelPlan);

/**
 * Duplicate travel plan
 * POST /api/travel-plans/:id/duplicate
 */
router.post(
  '/:id/duplicate',
  validate(duplicatePlanSchema),
  travelPlanController.duplicateTravelPlan
);

// ==================== SHARING ROUTES ====================

/**
 * Share travel plan with another user
 * POST /api/travel-plans/:id/share
 */
router.post(
  '/:id/share',
  validate(sharePlanSchema),
  travelPlanController.shareTravelPlan
);

/**
 * Revoke access from a user
 * DELETE /api/travel-plans/:id/share/:email
 */
router.delete('/:id/share/:email', travelPlanController.revokeAccess);

/**
 * Get users with access to this plan
 * GET /api/travel-plans/:id/shared-users
 */
router.get('/:id/shared-users', travelPlanController.getSharedUsers);

// ==================== AI FEATURES ====================

/**
 * Generate AI itinerary
 * POST /api/travel-plans/:id/generate-itinerary
 */
router.post(
  '/:id/generate-itinerary',
  validate(generateItinerarySchema),
  travelPlanController.generateItinerary
);

/**
 * Get AI recommendations
 * GET /api/travel-plans/:id/recommendations
 */
router.get('/:id/recommendations', travelPlanController.getRecommendations);

// ==================== BUDGET MANAGEMENT ====================

/**
 * Update travel plan budget
 * PATCH /api/travel-plans/:id/budget
 */
router.patch(
  '/:id/budget',
  validate(updateBudgetSchema),
  travelPlanController.updateBudget
);

/**
 * Get budget breakdown
 * GET /api/travel-plans/:id/budget/breakdown
 */
router.get('/:id/budget/breakdown', travelPlanController.getBudgetBreakdown);

/**
 * Get spending by category
 * GET /api/travel-plans/:id/budget/by-category
 */
router.get('/:id/budget/by-category', travelPlanController.getSpendingByCategory);

// ==================== STATISTICS & EXPORT ====================

/**
 * Get travel plan statistics
 * GET /api/travel-plans/:id/stats
 */
router.get('/:id/stats', travelPlanController.getTravelPlanStats);

/**
 * Export travel plan
 * GET /api/travel-plans/:id/export
 */
router.get(
  '/:id/export',
  validate(exportQuerySchema, 'query'),
  travelPlanController.exportTravelPlan
);

// ==================== FAVORITES ====================

/**
 * Add travel plan to favorites
 * POST /api/travel-plans/:id/favorite
 */
router.post('/:id/favorite', travelPlanController.addToFavorites);

/**
 * Remove travel plan from favorites
 * DELETE /api/travel-plans/:id/favorite
 */
router.delete('/:id/favorite', travelPlanController.removeFromFavorites);

/**
 * Get user's favorite travel plans
 * GET /api/travel-plans/favorites
 */
router.get('/favorites/list', travelPlanController.getFavorites);

// ==================== ACCOMMODATION BOOKINGS ====================

/**
 * Add accommodation booking to travel plan
 * POST /api/travel-plans/:id/accommodations
 */
router.post(
  '/:id/accommodations',
  validate(accommodationBookingSchema),
  travelPlanController.addAccommodationBooking
);

/**
 * Update accommodation booking
 * PUT /api/travel-plans/bookings/accommodation/:bookingId
 */
router.put(
  '/bookings/accommodation/:bookingId',
  validate(updateAccommodationBookingSchema),
  travelPlanController.updateAccommodationBooking
);

/**
 * Cancel accommodation booking
 * DELETE /api/travel-plans/bookings/accommodation/:bookingId
 */
router.delete(
  '/bookings/accommodation/:bookingId',
  travelPlanController.cancelAccommodationBooking
);

// ==================== TRANSPORTATION BOOKINGS ====================

/**
 * Add transportation booking to travel plan
 * POST /api/travel-plans/:id/transportation
 */
router.post(
  '/:id/transportation',
  validate(transportationBookingSchema),
  travelPlanController.addTransportationBooking
);

/**
 * Update transportation booking
 * PUT /api/travel-plans/bookings/transportation/:bookingId
 */
router.put(
  '/bookings/transportation/:bookingId',
  validate(updateTransportationBookingSchema),
  travelPlanController.updateTransportationBooking
);

/**
 * Cancel transportation booking
 * DELETE /api/travel-plans/bookings/transportation/:bookingId
 */
router.delete(
  '/bookings/transportation/:bookingId',
  travelPlanController.cancelTransportationBooking
);

// ==================== PACKAGE BOOKINGS ====================

/**
 * Add package booking to travel plan
 * POST /api/travel-plans/:id/packages
 */
router.post(
  '/:id/packages',
  validate(packageBookingSchema),
  travelPlanController.addPackageBooking
);

/**
 * Update package booking
 * PUT /api/travel-plans/bookings/package/:bookingId
 */
router.put(
  '/bookings/package/:bookingId',
  validate(updatePackageBookingSchema),
  travelPlanController.updatePackageBooking
);

/**
 * Cancel package booking
 * DELETE /api/travel-plans/bookings/package/:bookingId
 */
router.delete(
  '/bookings/package/:bookingId',
  travelPlanController.cancelPackageBooking
);

// ==================== EXPERIENCE BOOKINGS ====================

/**
 * Add experience booking to travel plan
 * POST /api/travel-plans/:id/experiences
 */
router.post(
  '/:id/experiences',
  validate(experienceBookingSchema),
  travelPlanController.addExperienceBooking
);

/**
 * Update experience booking
 * PUT /api/travel-plans/bookings/experience/:bookingId
 */
router.put(
  '/bookings/experience/:bookingId',
  validate(updateExperienceBookingSchema),
  travelPlanController.updateExperienceBooking
);

/**
 * Cancel experience booking
 * DELETE /api/travel-plans/bookings/experience/:bookingId
 */
router.delete(
  '/bookings/experience/:bookingId',
  travelPlanController.cancelExperienceBooking
);

// ==================== SHOPPING VISITS ====================

/**
 * Add shopping visit to travel plan
 * POST /api/travel-plans/:id/shopping
 */
router.post(
  '/:id/shopping',
  validate(shoppingVisitSchema),
  travelPlanController.addShoppingVisit
);

/**
 * Update shopping visit
 * PUT /api/travel-plans/shopping/:visitId
 */
router.put(
  '/shopping/:visitId',
  validate(updateShoppingVisitSchema),
  travelPlanController.updateShoppingVisit
);

/**
 * Cancel shopping visit
 * DELETE /api/travel-plans/shopping/:visitId
 */
router.delete(
  '/shopping/:visitId',
  travelPlanController.cancelShoppingVisit
);

// ==================== CUSTOM EXPERIENCES ====================

/**
 * Add custom travel experience
 * POST /api/travel-plans/:id/experiences/custom
 */
router.post(
  '/:id/experiences/custom',
  validate(travelExperienceSchema),
  travelPlanController.addTravelExperience
);

/**
 * Update custom travel experience
 * PUT /api/travel-plans/experiences/custom/:experienceId
 */
router.put(
  '/experiences/custom/:experienceId',
  validate(updateTravelExperienceSchema),
  travelPlanController.updateTravelExperience
);

/**
 * Delete custom travel experience
 * DELETE /api/travel-plans/experiences/custom/:experienceId
 */
router.delete(
  '/experiences/custom/:experienceId',
  travelPlanController.deleteTravelExperience
);

module.exports = router;