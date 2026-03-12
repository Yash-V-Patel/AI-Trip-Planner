const express = require('express');
const router = express.Router();
const travelPlanController = require('../controllers/travelplan.controller');
const authMiddleware = require('../middleware/auth.middleware');
// const adminMiddleware = require('../middleware/admin.m'); // assuming you have one
const validate = require('../middleware/validate.middleware');
const {
  createTravelPlanSchema,
  updateTravelPlanSchema,
  sharePlanSchema,
  generateItinerarySchema,
  duplicatePlanSchema,
  updateBudgetSchema,
  updatePlanStatusSchema,
  updateSharedPermissionSchema,
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
  exportQuerySchema,
  adminUpdatePlanStatusSchema,
  adminDeletePlanSchema
} = require('../schemas/travelplan.schema');

// All travel plan routes require authentication
router.use(authMiddleware.authenticate);

// ==================== CORE TRAVEL PLAN ROUTES ====================

/**
 * @swagger
 * tags:
 *   name: Travel Plans
 *   description: Travel plan management
 */

/**
 * @swagger
 * /api/travel-plans:
 *   post:
 *     summary: Create a new travel plan
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTravelPlanInput'
 *     responses:
 *       201:
 *         description: Travel plan created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TravelPlan'
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/',
  validate(createTravelPlanSchema),
  travelPlanController.createTravelPlan
);

/**
 * @swagger
 * /api/travel-plans:
 *   get:
 *     summary: Get all travel plans for current user
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNING, ONGOING, COMPLETED, CANCELLED]
 *         description: Filter by plan status
 *       - in: query
 *         name: destination
 *         schema:
 *           type: string
 *         description: Filter by destination (partial match)
 *       - in: query
 *         name: fromDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter plans starting after this date
 *       - in: query
 *         name: toDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter plans ending before this date
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [startDate, endDate, createdAt, updatedAt, title, destination]
 *           default: startDate
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Sort order
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Bypass cache
 *     responses:
 *       200:
 *         description: List of travel plans
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TravelPlanListItem'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Unauthorized
 */
router.get('/', travelPlanController.getTravelPlans);

/**
 * @swagger
 * /api/travel-plans/{id}:
 *   get:
 *     summary: Get travel plan by ID
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Bypass cache
 *     responses:
 *       200:
 *         description: Travel plan details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TravelPlanDetail'
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id', travelPlanController.getTravelPlanById);

/**
 * @swagger
 * /api/travel-plans/{id}:
 *   put:
 *     summary: Update travel plan
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTravelPlanInput'
 *     responses:
 *       200:
 *         description: Travel plan updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TravelPlan'
 *                 message:
 *                   type: string
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/:id',
  validate(updateTravelPlanSchema),
  travelPlanController.updateTravelPlan
);

/**
 * @swagger
 * /api/travel-plans/{id}/status:
 *   patch:
 *     summary: Update travel plan status (lightweight)
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PLANNING, ONGOING, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.patch(
  '/:id/status',
  validate(updatePlanStatusSchema),
  travelPlanController.updatePlanStatus
);

/**
 * @swagger
 * /api/travel-plans/{id}:
 *   delete:
 *     summary: Delete travel plan
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Travel plan deleted successfully
 *       400:
 *         description: Cannot delete plan with active bookings
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.delete('/:id', travelPlanController.deleteTravelPlan);

/**
 * @swagger
 * /api/travel-plans/{id}/duplicate:
 *   post:
 *     summary: Duplicate travel plan
 *     tags: [Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the plan to duplicate
 *       - in: query
 *         name: copyItinerary
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Copy itinerary and recommendations from original
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DuplicatePlanInput'
 *     responses:
 *       201:
 *         description: Travel plan duplicated successfully
 *       404:
 *         description: Original travel plan not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/duplicate',
  validate(duplicatePlanSchema),
  travelPlanController.duplicateTravelPlan
);

// ==================== SHARING ROUTES ====================

/**
 * @swagger
 * /api/travel-plans/{id}/share:
 *   post:
 *     summary: Share travel plan with another user
 *     tags: [Travel Plans - Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SharePlanInput'
 *     responses:
 *       200:
 *         description: Travel plan shared successfully
 *       400:
 *         description: Invalid input or self-share
 *       404:
 *         description: Plan or user not found
 *       403:
 *         description: Forbidden
 *       409:
 *         description: User already has this permission
 */
router.post(
  '/:id/share',
  validate(sharePlanSchema),
  travelPlanController.shareTravelPlan
);

/**
 * @swagger
 * /api/travel-plans/{id}/share/{email}:
 *   patch:
 *     summary: Update an existing collaborator's permission level
 *     tags: [Travel Plans - Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Email of the collaborator
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - permission
 *             properties:
 *               permission:
 *                 type: string
 *                 enum: [viewer, editor, suggester]
 *     responses:
 *       200:
 *         description: Permission updated successfully
 *       400:
 *         description: Invalid permission
 *       404:
 *         description: Plan or user not found
 *       403:
 *         description: Forbidden
 */
router.patch(
  '/:id/share/:email',
  validate(updateSharedPermissionSchema),
  travelPlanController.updateSharedUserPermission
);

/**
 * @swagger
 * /api/travel-plans/{id}/share/{email}:
 *   delete:
 *     summary: Revoke access from a user
 *     tags: [Travel Plans - Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Email of the user to revoke access from
 *     responses:
 *       200:
 *         description: Access revoked successfully
 *       404:
 *         description: Plan or user not found
 *       403:
 *         description: Forbidden
 */
router.delete('/:id/share/:email', travelPlanController.revokeAccess);

/**
 * @swagger
 * /api/travel-plans/{id}/shared-users:
 *   get:
 *     summary: Get users with access to this plan
 *     tags: [Travel Plans - Sharing]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of shared users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       permission:
 *                         type: string
 *                       user:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           email:
 *                             type: string
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/shared-users', travelPlanController.getSharedUsers);

// ==================== AI FEATURES ====================

/**
 * @swagger
 * /api/travel-plans/{id}/generate-itinerary:
 *   post:
 *     summary: Generate AI itinerary
 *     tags: [Travel Plans - AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateItineraryInput'
 *     responses:
 *       200:
 *         description: Itinerary generated successfully
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/generate-itinerary',
  validate(generateItinerarySchema),
  travelPlanController.generateItinerary
);

/**
 * @swagger
 * /api/travel-plans/{id}/recommendations:
 *   get:
 *     summary: Get AI recommendations for the travel plan
 *     tags: [Travel Plans - AI]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Recommendations (if any)
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/recommendations', travelPlanController.getRecommendations);

// ==================== BUDGET MANAGEMENT ====================

/**
 * @swagger
 * /api/travel-plans/{id}/budget:
 *   patch:
 *     summary: Update travel plan budget
 *     tags: [Travel Plans - Budget]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateBudgetInput'
 *     responses:
 *       200:
 *         description: Budget updated successfully
 *       400:
 *         description: Invalid budget value
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.patch(
  '/:id/budget',
  validate(updateBudgetSchema),
  travelPlanController.updateBudget
);

/**
 * @swagger
 * /api/travel-plans/{id}/budget/breakdown:
 *   get:
 *     summary: Get budget breakdown (spent, remaining, by category)
 *     tags: [Travel Plans - Budget]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Budget breakdown
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/budget/breakdown', travelPlanController.getBudgetBreakdown);

/**
 * @swagger
 * /api/travel-plans/{id}/budget/by-category:
 *   get:
 *     summary: Get spending by category
 *     tags: [Travel Plans - Budget]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Spending by category
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/budget/by-category', travelPlanController.getSpendingByCategory);

// ==================== TIMELINE ====================

/**
 * @swagger
 * /api/travel-plans/{id}/timeline:
 *   get:
 *     summary: Get unified timeline of all bookings/experiences
 *     tags: [Travel Plans - Timeline]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Chronological list of events
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/timeline', travelPlanController.getTimeline);

// ==================== STATISTICS & EXPORT ====================

/**
 * @swagger
 * /api/travel-plans/{id}/stats:
 *   get:
 *     summary: Get travel plan statistics
 *     tags: [Travel Plans - Stats]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Statistics
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/stats', travelPlanController.getTravelPlanStats);

/**
 * @swagger
 * /api/travel-plans/{id}/export:
 *   get:
 *     summary: Export travel plan
 *     tags: [Travel Plans - Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, pdf]
 *           default: json
 *         description: Export format
 *     responses:
 *       200:
 *         description: Exported file
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Unsupported format
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get(
  '/:id/export',
  validate(exportQuerySchema, 'query'),
  travelPlanController.exportTravelPlan
);

// ==================== ACCOMMODATION BOOKINGS ====================

/**
 * @swagger
 * tags:
 *   name: Accommodation Bookings
 *   description: Accommodation booking management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/accommodations:
 *   get:
 *     summary: List all accommodation bookings for a plan
 *     tags: [Accommodation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of accommodation bookings
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/accommodations', travelPlanController.getAccommodationBookings);

/**
 * @swagger
 * /api/travel-plans/{id}/accommodations:
 *   post:
 *     summary: Add accommodation booking to travel plan
 *     tags: [Accommodation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AccommodationBookingInput'
 *     responses:
 *       201:
 *         description: Accommodation booking added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan or accommodation not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/accommodations',
  validate(accommodationBookingSchema),
  travelPlanController.addAccommodationBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/accommodation/{bookingId}:
 *   put:
 *     summary: Update accommodation booking
 *     tags: [Accommodation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Accommodation booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAccommodationBookingInput'
 *     responses:
 *       200:
 *         description: Booking updated successfully
 *       400:
 *         description: Validation error or terminal status
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/bookings/accommodation/:bookingId',
  validate(updateAccommodationBookingSchema),
  travelPlanController.updateAccommodationBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/accommodation/{bookingId}:
 *   delete:
 *     summary: Cancel accommodation booking
 *     tags: [Accommodation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Accommodation booking ID
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Cannot cancel active/completed booking
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/bookings/accommodation/:bookingId',
  travelPlanController.cancelAccommodationBooking
);

// ==================== TRANSPORTATION BOOKINGS ====================

/**
 * @swagger
 * tags:
 *   name: Transportation Bookings
 *   description: Transportation booking management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/transportation:
 *   get:
 *     summary: List all transportation bookings for a plan
 *     tags: [Transportation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of transportation bookings
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/transportation', travelPlanController.getTransportationBookings);

/**
 * @swagger
 * /api/travel-plans/{id}/transportation:
 *   post:
 *     summary: Add transportation booking to travel plan
 *     tags: [Transportation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransportationBookingInput'
 *     responses:
 *       201:
 *         description: Transportation booking added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan or provider not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/transportation',
  validate(transportationBookingSchema),
  travelPlanController.addTransportationBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/transportation/{bookingId}:
 *   put:
 *     summary: Update transportation booking
 *     tags: [Transportation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transportation booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTransportationBookingInput'
 *     responses:
 *       200:
 *         description: Booking updated successfully
 *       400:
 *         description: Validation error or terminal status
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/bookings/transportation/:bookingId',
  validate(updateTransportationBookingSchema),
  travelPlanController.updateTransportationBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/transportation/{bookingId}:
 *   delete:
 *     summary: Cancel transportation booking
 *     tags: [Transportation Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Transportation booking ID
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Cannot cancel in-progress/completed booking
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/bookings/transportation/:bookingId',
  travelPlanController.cancelTransportationBooking
);

// ==================== PACKAGE BOOKINGS ====================

/**
 * @swagger
 * tags:
 *   name: Package Bookings
 *   description: Travel package booking management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/packages:
 *   get:
 *     summary: List all package bookings for a plan
 *     tags: [Package Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of package bookings
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/packages', travelPlanController.getPackageBookings);

/**
 * @swagger
 * /api/travel-plans/{id}/packages:
 *   post:
 *     summary: Add package booking to travel plan
 *     tags: [Package Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PackageBookingInput'
 *     responses:
 *       201:
 *         description: Package booking added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan or package not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/packages',
  validate(packageBookingSchema),
  travelPlanController.addPackageBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/package/{bookingId}:
 *   put:
 *     summary: Update package booking
 *     tags: [Package Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Package booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePackageBookingInput'
 *     responses:
 *       200:
 *         description: Booking updated successfully
 *       400:
 *         description: Validation error or terminal status
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/bookings/package/:bookingId',
  validate(updatePackageBookingSchema),
  travelPlanController.updatePackageBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/package/{bookingId}:
 *   delete:
 *     summary: Cancel package booking
 *     tags: [Package Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Package booking ID
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Cannot cancel completed booking
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/bookings/package/:bookingId',
  travelPlanController.cancelPackageBooking
);

// ==================== EXPERIENCE BOOKINGS (VENDOR) ====================

/**
 * @swagger
 * tags:
 *   name: Experience Bookings
 *   description: Vendor experience booking management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/experiences:
 *   get:
 *     summary: List all experience bookings (vendor) for a plan
 *     tags: [Experience Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of experience bookings
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/experiences', travelPlanController.getExperienceBookings);

/**
 * @swagger
 * /api/travel-plans/{id}/experiences:
 *   post:
 *     summary: Add experience booking to travel plan
 *     tags: [Experience Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ExperienceBookingInput'
 *     responses:
 *       201:
 *         description: Experience booking added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan or experience not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/experiences',
  validate(experienceBookingSchema),
  travelPlanController.addExperienceBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/experience/{bookingId}:
 *   put:
 *     summary: Update experience booking
 *     tags: [Experience Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Experience booking ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateExperienceBookingInput'
 *     responses:
 *       200:
 *         description: Booking updated successfully
 *       400:
 *         description: Validation error or terminal status
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/bookings/experience/:bookingId',
  validate(updateExperienceBookingSchema),
  travelPlanController.updateExperienceBooking
);

/**
 * @swagger
 * /api/travel-plans/bookings/experience/{bookingId}:
 *   delete:
 *     summary: Cancel experience booking
 *     tags: [Experience Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Experience booking ID
 *     responses:
 *       200:
 *         description: Booking cancelled successfully
 *       400:
 *         description: Cannot cancel completed booking
 *       404:
 *         description: Booking not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/bookings/experience/:bookingId',
  travelPlanController.cancelExperienceBooking
);

// ==================== SHOPPING VISITS ====================

/**
 * @swagger
 * tags:
 *   name: Shopping Visits
 *   description: Shopping visit management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/shopping:
 *   get:
 *     summary: List all shopping visits for a plan
 *     tags: [Shopping Visits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of shopping visits
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/shopping', travelPlanController.getShoppingVisits);

/**
 * @swagger
 * /api/travel-plans/{id}/shopping:
 *   post:
 *     summary: Add shopping visit to travel plan
 *     tags: [Shopping Visits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShoppingVisitInput'
 *     responses:
 *       201:
 *         description: Shopping visit added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan or store not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/shopping',
  validate(shoppingVisitSchema),
  travelPlanController.addShoppingVisit
);

/**
 * @swagger
 * /api/travel-plans/shopping/{visitId}:
 *   put:
 *     summary: Update shopping visit
 *     tags: [Shopping Visits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema:
 *           type: string
 *         description: Shopping visit ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateShoppingVisitInput'
 *     responses:
 *       200:
 *         description: Shopping visit updated successfully
 *       400:
 *         description: Validation error or terminal status
 *       404:
 *         description: Shopping visit not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/shopping/:visitId',
  validate(updateShoppingVisitSchema),
  travelPlanController.updateShoppingVisit
);

/**
 * @swagger
 * /api/travel-plans/shopping/{visitId}:
 *   delete:
 *     summary: Cancel shopping visit
 *     tags: [Shopping Visits]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema:
 *           type: string
 *         description: Shopping visit ID
 *     responses:
 *       200:
 *         description: Shopping visit cancelled successfully
 *       400:
 *         description: Cannot cancel completed visit
 *       404:
 *         description: Shopping visit not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/shopping/:visitId',
  travelPlanController.cancelShoppingVisit
);

// ==================== CUSTOM EXPERIENCES ====================

/**
 * @swagger
 * tags:
 *   name: Custom Experiences
 *   description: Custom travel experience management within travel plans
 */

/**
 * @swagger
 * /api/travel-plans/{id}/experiences/custom:
 *   get:
 *     summary: List all custom travel experiences for a plan
 *     tags: [Custom Experiences]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: List of custom experiences
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/:id/experiences/custom', travelPlanController.getCustomExperiences);

/**
 * @swagger
 * /api/travel-plans/{id}/experiences/custom:
 *   post:
 *     summary: Add custom travel experience
 *     tags: [Custom Experiences]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TravelExperienceInput'
 *     responses:
 *       201:
 *         description: Travel experience added successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:id/experiences/custom',
  validate(travelExperienceSchema),
  travelPlanController.addTravelExperience
);

/**
 * @swagger
 * /api/travel-plans/experiences/custom/{experienceId}:
 *   put:
 *     summary: Update custom travel experience
 *     tags: [Custom Experiences]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom experience ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTravelExperienceInput'
 *     responses:
 *       200:
 *         description: Experience updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Experience not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/experiences/custom/:experienceId',
  validate(updateTravelExperienceSchema),
  travelPlanController.updateTravelExperience
);

/**
 * @swagger
 * /api/travel-plans/experiences/custom/{experienceId}:
 *   delete:
 *     summary: Delete custom travel experience
 *     tags: [Custom Experiences]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Custom experience ID
 *     responses:
 *       200:
 *         description: Experience deleted successfully
 *       404:
 *         description: Experience not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/experiences/custom/:experienceId',
  travelPlanController.deleteTravelExperience
);

// ==================== FAVORITES ====================
// (Placeholder – adjust if you implement favorites)
// router.post('/:id/favorite', travelPlanController.addToFavorites);
// router.delete('/:id/favorite', travelPlanController.removeFromFavorites);
// router.get('/favorites', travelPlanController.getFavorites);

// ==================== SUPER-ADMIN ROUTES ====================
// All routes below require super-admin privileges

/**
 * @swagger
 * tags:
 *   name: Admin Travel Plans
 *   description: Super-admin endpoints for travel plan management
 */

/**
 * @swagger
 * /api/admin/travel-plans:
 *   get:
 *     summary: Get all plans across all users (super‑admin)
 *     tags: [Admin Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNING, ONGOING, COMPLETED, CANCELLED]
 *       - in: query
 *         name: destination
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in title and destination
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [startDate, endDate, createdAt, updatedAt, title, destination]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: List of all travel plans
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 */
router.get('/admin/travel-plans', travelPlanController.adminGetAllPlans);

/**
 * @swagger
 * /api/admin/travel-plans/{id}:
 *   get:
 *     summary: Get full plan details (admin view, includes PII)
 *     tags: [Admin Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     responses:
 *       200:
 *         description: Travel plan details with PII
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.get('/admin/travel-plans/:id', travelPlanController.adminGetPlanById);

/**
 * @swagger
 * /api/admin/travel-plans/{id}/status:
 *   put:
 *     summary: Force update plan status (admin)
 *     tags: [Admin Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUpdatePlanStatusInput'
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.put(
  '/admin/travel-plans/:id/status',
  validate(adminUpdatePlanStatusSchema),
  travelPlanController.adminUpdatePlanStatus
);

/**
 * @swagger
 * /api/admin/travel-plans/{id}:
 *   delete:
 *     summary: Force delete plan (admin) – bypasses active booking checks
 *     tags: [Admin Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Travel plan ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminDeletePlanInput'
 *     responses:
 *       200:
 *         description: Plan deleted
 *       404:
 *         description: Travel plan not found
 *       403:
 *         description: Forbidden
 */
router.delete(
  '/admin/travel-plans/:id',
  validate(adminDeletePlanSchema),
  travelPlanController.adminDeletePlan
);

/**
 * @swagger
 * /api/admin/travel-plans/stats:
 *   get:
 *     summary: Platform‑wide statistics (admin)
 *     tags: [Admin Travel Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date filter
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date filter
 *     responses:
 *       200:
 *         description: Platform statistics
 *       403:
 *         description: Forbidden
 */
router.get('/admin/travel-plans/stats', travelPlanController.adminGetPlatformStats);

module.exports = router;