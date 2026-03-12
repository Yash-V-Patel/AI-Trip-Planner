// routes/transportation.routes.js
const express = require('express');
const router = express.Router();
const transportationController = require('../controllers/transportation.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  // Provider schemas
  createProviderSchema,
  updateProviderSchema,
  toggleProviderStatusSchema,
  providerStatsSchema,
  providerBookingsQuerySchema,
  
  // Vehicle schemas
  createVehicleSchema,
  updateVehicleSchema,
  bulkVehiclesSchema,
  updateLocationSchema,
  bulkUpdateVehicleAvailabilitySchema,
  vehicleHistoryQuerySchema,
  
  // Booking schemas
  createBookingSchema,
  updateBookingSchema,
  fareCalculationSchema,
  availableVehiclesQuerySchema,
  
  // Admin schemas
  adminProvidersQuerySchema,
  adminVerifyProviderSchema,
  adminFeatureProviderSchema,
  adminBookingsQuerySchema,
  adminUpdateBookingStatusSchema
} = require('../schemas/transportation.schema');

// ==================== PUBLIC ROUTES (No Authentication) ====================

/**
 * @swagger
 * /api/transportation/providers:
 *   get:
 *     summary: Get all transportation providers (public)
 *     tags: [Transportation - Public]
 *     parameters:
 *       - in: query
 *         name: providerType
 *         schema:
 *           type: string
 *           enum: [TAXI_SERVICE, RIDE_SHARING, CAR_RENTAL, BUS_COMPANY, TRAIN_SERVICE, AIRLINE, FERRY_SERVICE, BICYCLE_RENTAL, OTHER]
 *         description: Filter by provider type
 *       - in: query
 *         name: city
 *         schema:
 *           type: string
 *         description: Filter by city (service area)
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *         description: Search by location (name or service area)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Keyword search in name/description
 *       - in: query
 *         name: minRating
 *         schema:
 *           type: number
 *           minimum: 0
 *           maximum: 5
 *         description: Minimum rating filter
 *       - in: query
 *         name: vehicleType
 *         schema:
 *           type: string
 *         description: Filter by vehicle type
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, name, rating, baseFare]
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
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
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of providers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TransportationProvider'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *                 filters:
 *                   type: object
 */
router.get('/providers', transportationController.getAllProviders);

/**
 * @swagger
 * /api/transportation/providers/{id}:
 *   get:
 *     summary: Get provider by ID (public)
 *     tags: [Transportation - Public]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider ID
 *       - in: query
 *         name: skipCache
 *         schema:
 *           type: boolean
 *         description: Bypass cache
 *     responses:
 *       200:
 *         description: Provider details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TransportationProvider'
 *                 cached:
 *                   type: boolean
 *       404:
 *         description: Provider not found
 */
router.get('/providers/:id', transportationController.getProviderById);

/**
 * @swagger
 * /api/transportation/providers/{providerId}/available-vehicles:
 *   get:
 *     summary: Get available vehicles for a provider within a time window (public)
 *     tags: [Transportation - Public]
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider ID
 *       - in: query
 *         name: pickupTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Pickup date/time (ISO)
 *       - in: query
 *         name: dropoffTime
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Dropoff date/time (ISO)
 *       - in: query
 *         name: passengers
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Number of passengers
 *       - in: query
 *         name: vehicleType
 *         schema:
 *           type: string
 *         description: Filter by vehicle type
 *     responses:
 *       200:
 *         description: List of available vehicles
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
 *                     $ref: '#/components/schemas/TransportationVehicle'
 *                 totalAvailable:
 *                   type: integer
 *                 totalVehicles:
 *                   type: integer
 *                 fareInfo:
 *                   type: object
 *                   properties:
 *                     baseFare:
 *                       type: number
 *                     perKmRate:
 *                       type: number
 *                     perMinuteRate:
 *                       type: number
 */
router.get(
  '/providers/:providerId/available-vehicles',
  validate(availableVehiclesQuerySchema, 'query'),
  transportationController.getAvailableVehicles
);

/**
 * @swagger
 * /api/transportation/calculate-fare:
 *   post:
 *     summary: Calculate estimated fare (public)
 *     tags: [Transportation - Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - providerId
 *             properties:
 *               providerId:
 *                 type: string
 *               distance:
 *                 type: number
 *                 description: Distance in km
 *               duration:
 *                 type: number
 *                 description: Duration in minutes
 *               vehicleType:
 *                 type: string
 *                 description: Vehicle type for premium calculation
 *     responses:
 *       200:
 *         description: Fare estimate
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     estimatedFare:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     breakdown:
 *                       type: object
 *                       properties:
 *                         baseFare:
 *                           type: number
 *                         distanceCharge:
 *                           type: number
 *                         timeCharge:
 *                           type: number
 *                         premiumCharge:
 *                           type: number
 */
router.post(
  '/calculate-fare',
  validate(fareCalculationSchema),
  transportationController.calculateFare
);

// ==================== AUTHENTICATED ROUTES ====================
router.use(authMiddleware.authenticate);

// -------------------- Provider Management --------------------

/**
 * @swagger
 * /api/transportation/providers:
 *   post:
 *     summary: Create a new transportation provider (vendors only)
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - providerType
 *               - serviceArea
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 255
 *               description:
 *                 type: string
 *                 maxLength: 2000
 *               providerType:
 *                 type: string
 *                 enum: [TAXI_SERVICE, RIDE_SHARING, CAR_RENTAL, BUS_COMPANY, TRAIN_SERVICE, AIRLINE, FERRY_SERVICE, BICYCLE_RENTAL, OTHER]
 *               serviceArea:
 *                 type: array
 *                 items:
 *                   type: string
 *               contactNumber:
 *                 type: string
 *                 pattern: '^[0-9+\-\s()]{10,20}$'
 *               email:
 *                 type: string
 *                 format: email
 *               website:
 *                 type: string
 *                 format: uri
 *               baseFare:
 *                 type: number
 *               perKmRate:
 *                 type: number
 *               perMinuteRate:
 *                 type: number
 *               isAvailable:
 *                 type: boolean
 *                 default: true
 *               operatingHours:
 *                 type: object
 *               vehicleTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Provider created
 *       403:
 *         description: Not authorized (not a vendor)
 *       409:
 *         description: Provider name already exists
 */
router.post(
  '/providers',
  validate(createProviderSchema),
  transportationController.createProvider
);

/**
 * @swagger
 * /api/transportation/my-providers:
 *   get:
 *     summary: Get current vendor's own providers
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by availability status
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         default: 20
 *     responses:
 *       200:
 *         description: List of vendor's providers
 */
router.get('/my-providers', transportationController.getMyProviders);

/**
 * @swagger
 * /api/transportation/providers/{id}:
 *   put:
 *     summary: Update a provider (owner/manager)
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               providerType:
 *                 type: string
 *               serviceArea:
 *                 type: array
 *                 items:
 *                   type: string
 *               contactNumber:
 *                 type: string
 *               email:
 *                 type: string
 *               website:
 *                 type: string
 *               baseFare:
 *                 type: number
 *               perKmRate:
 *                 type: number
 *               perMinuteRate:
 *                 type: number
 *               isAvailable:
 *                 type: boolean
 *               operatingHours:
 *                 type: object
 *               vehicleTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Provider updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Provider not found
 */
router.put(
  '/providers/:id',
  validate(updateProviderSchema),
  transportationController.updateProvider
);

/**
 * @swagger
 * /api/transportation/providers/{id}:
 *   delete:
 *     summary: Delete a provider (owner only, no active bookings)
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Provider deleted
 *       400:
 *         description: Cannot delete with active bookings
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Provider not found
 */
router.delete('/providers/:id', transportationController.deleteProvider);

/**
 * @swagger
 * /api/transportation/providers/{id}/status:
 *   patch:
 *     summary: Toggle provider availability status
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isAvailable
 *             properties:
 *               isAvailable:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch(
  '/providers/:id/status',
  validate(toggleProviderStatusSchema),
  transportationController.toggleProviderStatus
);

/**
 * @swagger
 * /api/transportation/providers/{id}/stats:
 *   get:
 *     summary: Get provider statistics
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Provider statistics
 */
router.get(
  '/providers/:id/stats',
  validate(providerStatsSchema, 'params'),
  transportationController.getProviderStats
);

/**
 * @swagger
 * /api/transportation/providers/{providerId}/bookings:
 *   get:
 *     summary: Get bookings for a specific provider (vendor)
 *     tags: [Transportation - Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [BOOKED, CONFIRMED, ON_THE_WAY, ARRIVED, CANCELLED, DELAYED, COMPLETED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         default: 20
 *     responses:
 *       200:
 *         description: List of bookings
 */
router.get(
  '/providers/:providerId/bookings',
  validate(providerBookingsQuerySchema, 'query'),
  transportationController.getProviderBookings
);

// -------------------- Vehicle Management --------------------

/**
 * @swagger
 * /api/transportation/providers/{providerId}/vehicles:
 *   post:
 *     summary: Add a vehicle to a provider
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleNumber
 *               - vehicleType
 *             properties:
 *               vehicleNumber:
 *                 type: string
 *               vehicleType:
 *                 type: string
 *               make:
 *                 type: string
 *               model:
 *                 type: string
 *               year:
 *                 type: integer
 *               color:
 *                 type: string
 *               capacity:
 *                 type: integer
 *               amenities:
 *                 type: array
 *                 items:
 *                   type: string
 *               driverName:
 *                 type: string
 *               driverContact:
 *                 type: string
 *               driverRating:
 *                 type: number
 *               isAvailable:
 *                 type: boolean
 *               currentLocation:
 *                 type: object
 *                 properties:
 *                   lat:
 *                     type: number
 *                   lng:
 *                     type: number
 *     responses:
 *       201:
 *         description: Vehicle added
 *       409:
 *         description: Vehicle number already exists
 */
router.post(
  '/providers/:providerId/vehicles',
  validate(createVehicleSchema),
  transportationController.addVehicle
);

/**
 * @swagger
 * /api/transportation/providers/{providerId}/vehicles/bulk:
 *   post:
 *     summary: Bulk add vehicles to a provider
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicles
 *             properties:
 *               vehicles:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 items:
 *                   $ref: '#/components/schemas/CreateVehicleInput'
 *     responses:
 *       201:
 *         description: Vehicles added
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
 *                     $ref: '#/components/schemas/TransportationVehicle'
 *                 message:
 *                   type: string
 */
router.post(
  '/providers/:providerId/vehicles/bulk',
  validate(bulkVehiclesSchema),
  transportationController.bulkAddVehicles
);

/**
 * @swagger
 * /api/transportation/vehicles/{vehicleId}:
 *   put:
 *     summary: Update a vehicle
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateVehicleInput'
 *     responses:
 *       200:
 *         description: Vehicle updated
 */
router.put(
  '/vehicles/:vehicleId',
  validate(updateVehicleSchema),
  transportationController.updateVehicle
);

/**
 * @swagger
 * /api/transportation/vehicles/{vehicleId}/location:
 *   patch:
 *     summary: Update vehicle current location
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lat
 *               - lng
 *             properties:
 *               lat:
 *                 type: number
 *                 minimum: -90
 *                 maximum: 90
 *               lng:
 *                 type: number
 *                 minimum: -180
 *                 maximum: 180
 *     responses:
 *       200:
 *         description: Location updated
 */
router.patch(
  '/vehicles/:vehicleId/location',
  validate(updateLocationSchema),
  transportationController.updateVehicleLocation
);

/**
 * @swagger
 * /api/transportation/vehicles/{vehicleId}:
 *   delete:
 *     summary: Delete a vehicle (no future bookings)
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vehicle deleted
 *       400:
 *         description: Cannot delete with future bookings
 */
router.delete('/vehicles/:vehicleId', transportationController.deleteVehicle);

/**
 * @swagger
 * /api/transportation/providers/{providerId}/vehicles/availability:
 *   patch:
 *     summary: Bulk update vehicle availability
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: providerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleIds
 *               - isAvailable
 *             properties:
 *               vehicleIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               isAvailable:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Availability updated
 */
router.patch(
  '/providers/:providerId/vehicles/availability',
  validate(bulkUpdateVehicleAvailabilitySchema),
  transportationController.bulkUpdateVehicleAvailability
);

/**
 * @swagger
 * /api/transportation/vehicles/{vehicleId}/history:
 *   get:
 *     summary: Get vehicle booking history
 *     tags: [Transportation - Vehicles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vehicleId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of bookings
 */
router.get(
  '/vehicles/:vehicleId/history',
  validate(vehicleHistoryQuerySchema, 'query'),
  transportationController.getVehicleHistory
);

// -------------------- Booking Management --------------------

/**
 * @swagger
 * /api/transportation/travel-plans/{travelPlanId}/transportation-bookings:
 *   post:
 *     summary: Create a transportation booking for a travel plan
 *     tags: [Transportation - Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: travelPlanId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - providerId
 *               - serviceType
 *               - pickupLocation
 *               - dropoffLocation
 *               - pickupTime
 *             properties:
 *               providerId:
 *                 type: string
 *               vehicleId:
 *                 type: string
 *               serviceType:
 *                 type: string
 *                 enum: [TAXI, BUS, TRAIN, FLIGHT, FERRY, CAR_RENTAL, BICYCLE, WALKING, OTHER]
 *               pickupLocation:
 *                 type: string
 *               dropoffLocation:
 *                 type: string
 *               pickupTime:
 *                 type: string
 *                 format: date-time
 *               estimatedArrival:
 *                 type: string
 *                 format: date-time
 *               numberOfPassengers:
 *                 type: integer
 *                 default: 1
 *               specialRequests:
 *                 type: string
 *               estimatedFare:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [CASH, CARD, DIGITAL_WALLET, ONLINE_PAYMENT, VOUCHER]
 *     responses:
 *       201:
 *         description: Booking created
 *       409:
 *         description: Vehicle not available for selected time
 */
router.post(
  '/travel-plans/:travelPlanId/transportation-bookings',
  validate(createBookingSchema),
  transportationController.createBooking
);

/**
 * @swagger
 * /api/transportation/bookings/{bookingId}:
 *   get:
 *     summary: Get booking by ID
 *     tags: [Transportation - Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking details
 */
router.get(
  '/bookings/:bookingId',
  transportationController.getBookingById
);

/**
 * @swagger
 * /api/transportation/bookings/{bookingId}:
 *   put:
 *     summary: Update a booking
 *     tags: [Transportation - Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               pickupLocation:
 *                 type: string
 *               dropoffLocation:
 *                 type: string
 *               pickupTime:
 *                 type: string
 *                 format: date-time
 *               estimatedArrival:
 *                 type: string
 *                 format: date-time
 *               numberOfPassengers:
 *                 type: integer
 *               specialRequests:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [BOOKED, CONFIRMED, ON_THE_WAY, ARRIVED, CANCELLED, DELAYED, COMPLETED]
 *               paymentMethod:
 *                 type: string
 *               paymentStatus:
 *                 type: string
 *               actualFare:
 *                 type: number
 *               actualPickupTime:
 *                 type: string
 *                 format: date-time
 *               actualDropoffTime:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Booking updated
 */
router.put(
  '/bookings/:bookingId',
  validate(updateBookingSchema),
  transportationController.updateBooking
);

/**
 * @swagger
 * /api/transportation/bookings/{bookingId}:
 *   delete:
 *     summary: Cancel a booking
 *     tags: [Transportation - Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking cancelled
 *       400:
 *         description: Already cancelled/completed
 */
router.delete(
  '/bookings/:bookingId',
  transportationController.cancelBooking
);

// ==================== ADMIN ROUTES (SuperAdmin only) ====================

/**
 * @swagger
 * /api/transportation/admin/transportation/providers:
 *   get:
 *     summary: Get all providers (admin)
 *     tags: [Transportation - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema:
 *           type: string
 *       - in: query
 *         name: isAvailable
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: isVerified
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: isFeatured
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: providerType
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, name, rating, baseFare]
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of providers
 */
router.get(
  '/admin/transportation/providers',
  validate(adminProvidersQuerySchema, 'query'),
  transportationController.adminGetAllProviders
);

/**
 * @swagger
 * /api/transportation/admin/transportation/providers/{id}/verify:
 *   patch:
 *     summary: Verify/unverify a provider (admin)
 *     tags: [Transportation - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isVerified
 *             properties:
 *               isVerified:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Provider verification updated
 */
router.patch(
  '/admin/transportation/providers/:id/verify',
  validate(adminVerifyProviderSchema),
  transportationController.verifyProvider
);

/**
 * @swagger
 * /api/transportation/admin/transportation/providers/{id}/feature:
 *   patch:
 *     summary: Feature/unfeature a provider (admin)
 *     tags: [Transportation - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isFeatured
 *             properties:
 *               isFeatured:
 *                 type: boolean
 *               featuredUntil:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Provider featured status updated
 */
router.patch(
  '/admin/transportation/providers/:id/feature',
  validate(adminFeatureProviderSchema),
  transportationController.featureProvider
);

/**
 * @swagger
 * /api/transportation/admin/transportation/bookings:
 *   get:
 *     summary: Get all bookings (admin)
 *     tags: [Transportation - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: providerId
 *         schema:
 *           type: string
 *       - in: query
 *         name: vehicleId
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of bookings
 */
router.get(
  '/admin/transportation/bookings',
  validate(adminBookingsQuerySchema, 'query'),
  transportationController.adminGetAllBookings
);

/**
 * @swagger
 * /api/transportation/admin/transportation/bookings/{bookingId}/status:
 *   patch:
 *     summary: Force update booking status (admin)
 *     tags: [Transportation - Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [BOOKED, CONFIRMED, ON_THE_WAY, ARRIVED, CANCELLED, DELAYED, COMPLETED]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking status updated
 */
router.patch(
  '/admin/transportation/bookings/:bookingId/status',
  validate(adminUpdateBookingStatusSchema),
  transportationController.adminUpdateBookingStatus
);

module.exports = router;