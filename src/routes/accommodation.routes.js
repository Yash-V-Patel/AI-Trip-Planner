// routes/accommodation.routes.js
const express = require('express');
const router = express.Router();
const accommodationController = require('../controllers/accommodation.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  // Core schemas
  createAccommodationSchema,
  updateAccommodationSchema,
  toggleAccommodationStatusSchema,
  // Room schemas
  createRoomSchema,
  updateRoomSchema,
  bulkUpdateRoomAvailabilitySchema,
  // Service schemas
  createServiceSchema,
  updateServiceSchema,
  // Booking schemas
  createBookingSchema,
  updateBookingSchema,
  availableRoomsQuerySchema,
  // Vendor-specific schemas
  vendorAccommodationsQuerySchema,
  vendorBookingsQuerySchema,
  // Admin schemas
  adminAccommodationsQuerySchema,
  adminVerifyAccommodationSchema,
  adminFeatureAccommodationSchema,
  adminBookingsQuerySchema,
  adminUpdateBookingStatusSchema
} = require('../schemas/accommodation.schema');

// ==================== PUBLIC ROUTES (No Authentication) ====================

/**
 * @swagger
 * tags:
 *   name: Accommodations
 *   description: Accommodation management (public and vendor/admin)
 */

/**
 * @swagger
 * /api/accommodations:
 *   get:
 *     summary: Get all accommodations (public)
 *     tags: [Accommodations]
 *     parameters:
 *       - in: query
 *         name: location
 *         schema: { type: string }
 *         description: Search by location (city, address, name)
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         description: Filter by city
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *         description: Filter by country
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [HOTEL, RESORT, MOTEL, HOSTEL, BED_BREAKFAST, VACATION_RENTAL, APARTMENT, GUEST_HOUSE] }
 *         description: Accommodation type
 *       - in: query
 *         name: minRating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
 *         description: Minimum star rating
 *       - in: query
 *         name: maxPrice
 *         schema: { type: integer }
 *         description: Maximum price (maps to price category)
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Keyword search in name/description
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, name, starRating, overallRating, city], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *     responses:
 *       200:
 *         description: List of accommodations with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Accommodation' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 filters: { type: object }
 */
router.get('/', accommodationController.getAllAccommodations);

/**
 * @swagger
 * /api/accommodations/{id}:
 *   get:
 *     summary: Get accommodation by ID (public)
 *     tags: [Accommodations]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: skipCache
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Accommodation details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/AccommodationDetail' }
 *                 cached: { type: boolean }
 *       404:
 *         description: Accommodation not found
 */
router.get('/:id', accommodationController.getAccommodationById);

/**
 * @swagger
 * /api/accommodations/{accommodationId}/available-rooms:
 *   get:
 *     summary: Get available rooms for given dates (public)
 *     tags: [Accommodations]
 *     parameters:
 *       - in: path
 *         name: accommodationId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: checkIn
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: checkOut
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: guests
 *         schema: { type: integer, minimum: 1, default: 1 }
 *     responses:
 *       200:
 *         description: List of available rooms
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Room' } }
 *                 totalAvailable: { type: integer }
 *                 totalRooms: { type: integer }
 */
router.get(
  '/:accommodationId/available-rooms',
  validate(availableRoomsQuerySchema, 'query'),
  accommodationController.getAvailableRooms
);

// ==================== AUTHENTICATED ROUTES ====================
router.use(authMiddleware.authenticate);

// -------------------- Accommodation Management --------------------

/**
 * @swagger
 * /api/accommodations:
 *   post:
 *     summary: Create a new accommodation (vendor only)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - city
 *               - country
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 2000 }
 *               address: { type: string, maxLength: 500 }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               latitude: { type: number, minimum: -90, maximum: 90 }
 *               longitude: { type: number, minimum: -180, maximum: 180 }
 *               phone: { type: string, pattern: '^[0-9+\\-\\s()]{10,20}$' }
 *               email: { type: string, format: email }
 *               website: { type: string, format: uri }
 *               starRating: { type: integer, minimum: 1, maximum: 5, default: 3 }
 *               accommodationType: { type: string, enum: [HOTEL, RESORT, MOTEL, HOSTEL, BED_BREAKFAST, VACATION_RENTAL, APARTMENT, GUEST_HOUSE], default: HOTEL }
 *               priceCategory: { type: string, enum: [BUDGET, MIDRANGE, LUXURY, BOUTIQUE], default: MIDRANGE }
 *               amenities: { type: array, items: { type: string } }
 *               images: { type: array, items: { type: string, format: uri } }
 *               checkInTime: { type: string, pattern: '^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$' }
 *               checkOutTime: { type: string, pattern: '^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$' }
 *               policies: { type: object }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Accommodation created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Accommodation' }
 *                 message: { type: string }
 *       403:
 *         description: Only approved vendors can create accommodations
 *       409:
 *         description: Accommodation with this name already exists
 */
router.post(
  '/',
  validate(createAccommodationSchema),
  accommodationController.createAccommodation
);

/**
 * @swagger
 * /api/accommodations/{id}:
 *   put:
 *     summary: Update accommodation (vendor owner or admin)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 2000 }
 *               address: { type: string, maxLength: 500 }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               phone: { type: string }
 *               email: { type: string, format: email }
 *               website: { type: string, format: uri }
 *               starRating: { type: integer, min: 1, max: 5 }
 *               accommodationType: { type: string, enum: [HOTEL, RESORT, MOTEL, HOSTEL, BED_BREAKFAST, VACATION_RENTAL, APARTMENT, GUEST_HOUSE] }
 *               priceCategory: { type: string, enum: [BUDGET, MIDRANGE, LUXURY, BOUTIQUE] }
 *               amenities: { type: array, items: { type: string } }
 *               images: { type: array, items: { type: string, format: uri } }
 *               checkInTime: { type: string }
 *               checkOutTime: { type: string }
 *               policies: { type: object }
 *               isActive: { type: boolean } (admin only)
 *     responses:
 *       200:
 *         description: Accommodation updated
 *       403:
 *         description: You can only update your own accommodations
 *       404:
 *         description: Accommodation not found
 */
router.put(
  '/:id',
  validate(updateAccommodationSchema),
  accommodationController.updateAccommodation
);

/**
 * @swagger
 * /api/accommodations/{id}:
 *   delete:
 *     summary: Delete accommodation (vendor owner with no active bookings)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Accommodation deleted
 *       400:
 *         description: Cannot delete with active bookings
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Accommodation not found
 */
router.delete('/:id', accommodationController.deleteAccommodation);

/**
 * @swagger
 * /api/accommodations/{id}/status:
 *   patch:
 *     summary: Toggle accommodation active status (vendor owner)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Status updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Accommodation not found
 */
router.patch(
  '/:id/status',
  validate(toggleAccommodationStatusSchema),
  accommodationController.toggleAccommodationStatus
);

// Vendor-specific accommodation endpoints

/**
 * @swagger
 * /api/accommodations/vendor/accommodations:
 *   get:
 *     summary: Get vendor's own accommodations (vendor)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of vendor's accommodations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Accommodation' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get(
  '/vendor/accommodations',
  validate(vendorAccommodationsQuerySchema, 'query'),
  accommodationController.getVendorAccommodations
);

/**
 * @swagger
 * /api/accommodations/vendor/accommodations/{accommodationId}/bookings:
 *   get:
 *     summary: Get bookings for a vendor's accommodation (vendor)
 *     tags: [Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accommodationId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, CONFIRMED, CANCELLED, CHECKED_IN, CHECKED_OUT, NO_SHOW] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/AccommodationBooking' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Accommodation not found
 */
router.get(
  '/vendor/accommodations/:accommodationId/bookings',
  validate(vendorBookingsQuerySchema, 'query'),
  accommodationController.getAccommodationBookings
);

// -------------------- Room Management --------------------

/**
 * @swagger
 * /api/accommodations/{accommodationId}/rooms:
 *   post:
 *     summary: Add a room to accommodation (vendor owner)
 *     tags: [Rooms]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accommodationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - roomNumber
 *               - roomType
 *               - basePrice
 *             properties:
 *               roomNumber: { type: string, maxLength: 50 }
 *               roomType: { type: string, enum: [SINGLE, DOUBLE, TWIN, TRIPLE, SUITE, DELUXE, FAMILY, PRESIDENTIAL] }
 *               description: { type: string, maxLength: 500 }
 *               beds: { type: integer, min: 1, max: 10, default: 1 }
 *               maxOccupancy: { type: integer, min: 1, max: 20, default: 2 }
 *               hasView: { type: boolean, default: false }
 *               hasBalcony: { type: boolean, default: false }
 *               floor: { type: integer, min: 0, max: 100 }
 *               roomAmenities: { type: array, items: { type: string } }
 *               basePrice: { type: number, positive: true }
 *               isAvailable: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Room added
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:accommodationId/rooms',
  validate(createRoomSchema),
  accommodationController.addRoom
);

/**
 * @swagger
 * /api/accommodations/rooms/{roomId}:
 *   put:
 *     summary: Update a room (vendor owner)
 *     tags: [Rooms]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roomNumber: { type: string }
 *               roomType: { type: string, enum: [SINGLE, DOUBLE, TWIN, TRIPLE, SUITE, DELUXE, FAMILY, PRESIDENTIAL] }
 *               description: { type: string }
 *               beds: { type: integer }
 *               maxOccupancy: { type: integer }
 *               hasView: { type: boolean }
 *               hasBalcony: { type: boolean }
 *               floor: { type: integer }
 *               roomAmenities: { type: array, items: { type: string } }
 *               basePrice: { type: number }
 *               isAvailable: { type: boolean }
 *     responses:
 *       200:
 *         description: Room updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Room not found
 */
router.put(
  '/rooms/:roomId',
  validate(updateRoomSchema),
  accommodationController.updateRoom
);

/**
 * @swagger
 * /api/accommodations/rooms/{roomId}:
 *   delete:
 *     summary: Delete a room (vendor owner, no future bookings)
 *     tags: [Rooms]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Room deleted
 *       400:
 *         description: Cannot delete room with future bookings
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Room not found
 */
router.delete('/rooms/:roomId', accommodationController.deleteRoom);

/**
 * @swagger
 * /api/accommodations/{accommodationId}/rooms/availability:
 *   patch:
 *     summary: Bulk update room availability (vendor owner)
 *     tags: [Rooms]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accommodationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - roomIds
 *               - isAvailable
 *             properties:
 *               roomIds: { type: array, items: { type: string } }
 *               isAvailable: { type: boolean }
 *     responses:
 *       200:
 *         description: Availability updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 updatedCount: { type: integer }
 *                 message: { type: string }
 *       403:
 *         description: Forbidden
 */
router.patch(
  '/:accommodationId/rooms/availability',
  validate(bulkUpdateRoomAvailabilitySchema),
  accommodationController.bulkUpdateRoomAvailability
);

// -------------------- Service Management --------------------

/**
 * @swagger
 * /api/accommodations/{accommodationId}/services:
 *   post:
 *     summary: Add a service to accommodation (vendor owner)
 *     tags: [Services]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: accommodationId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - category
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 500 }
 *               category: { type: string, enum: [DINING, WELLNESS, ENTERTAINMENT, BUSINESS, TRANSPORTATION, HOUSEKEEPING, CONCIERGE, OTHER] }
 *               price: { type: number, positive: true }
 *               isIncluded: { type: boolean, default: false }
 *               isAvailable: { type: boolean, default: true }
 *               availableStartTime: { type: string, pattern: '^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$' }
 *               availableEndTime: { type: string, pattern: '^([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)$' }
 *               daysAvailable: { type: array, items: { type: string, enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY] } }
 *               locationInAccommodation: { type: string, maxLength: 255 }
 *     responses:
 *       201:
 *         description: Service added
 *       403:
 *         description: Forbidden
 */
router.post(
  '/:accommodationId/services',
  validate(createServiceSchema),
  accommodationController.addService
);

/**
 * @swagger
 * /api/accommodations/services/{serviceId}:
 *   put:
 *     summary: Update a service (vendor owner)
 *     tags: [Services]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               category: { type: string, enum: [DINING, WELLNESS, ENTERTAINMENT, BUSINESS, TRANSPORTATION, HOUSEKEEPING, CONCIERGE, OTHER] }
 *               price: { type: number }
 *               isIncluded: { type: boolean }
 *               isAvailable: { type: boolean }
 *               availableStartTime: { type: string }
 *               availableEndTime: { type: string }
 *               daysAvailable: { type: array, items: { type: string } }
 *               locationInAccommodation: { type: string }
 *     responses:
 *       200:
 *         description: Service updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Service not found
 */
router.put(
  '/services/:serviceId',
  validate(updateServiceSchema),
  accommodationController.updateService
);

/**
 * @swagger
 * /api/accommodations/services/{serviceId}:
 *   delete:
 *     summary: Delete a service (vendor owner)
 *     tags: [Services]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Service deleted
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Service not found
 */
router.delete('/services/:serviceId', accommodationController.deleteService);

// -------------------- Booking Management (via Travel Plan) --------------------

/**
 * @swagger
 * /api/accommodations/travel-plans/{travelPlanId}/accommodation-bookings:
 *   post:
 *     summary: Create an accommodation booking for a travel plan
 *     tags: [Accommodation Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: travelPlanId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accommodationId
 *               - roomIds
 *               - checkInDate
 *               - checkOutDate
 *               - roomType
 *               - pricePerNight
 *               - totalCost
 *               - guestName
 *               - guestEmail
 *             properties:
 *               accommodationId: { type: string }
 *               roomIds: { type: array, items: { type: string } }
 *               checkInDate: { type: string, format: date }
 *               checkOutDate: { type: string, format: date }
 *               totalGuests: { type: integer, default: 1 }
 *               roomType: { type: string, enum: [SINGLE, DOUBLE, TWIN, TRIPLE, SUITE, DELUXE, FAMILY, PRESIDENTIAL] }
 *               pricePerNight: { type: number, positive: true }
 *               taxes: { type: number, default: 0 }
 *               serviceFee: { type: number, default: 0 }
 *               totalCost: { type: number, positive: true }
 *               guestName: { type: string }
 *               guestEmail: { type: string, format: email }
 *               guestPhone: { type: string }
 *               specialRequests: { type: string }
 *               paymentStatus: { type: string, enum: [PENDING, PAID, REFUNDED, FAILED, PARTIALLY_PAID] }
 *               paymentMethod: { type: string, enum: [CASH, CARD, DIGITAL_WALLET, ONLINE_PAYMENT, VOUCHER] }
 *               transactionId: { type: string }
 *     responses:
 *       201:
 *         description: Booking created
 *       403:
 *         description: You do not have permission to add bookings to this travel plan
 *       409:
 *         description: Room(s) already booked for these dates
 */
router.post(
  '/travel-plans/:travelPlanId/accommodation-bookings',
  validate(createBookingSchema),
  accommodationController.createBooking
);

/**
 * @swagger
 * /api/accommodations/accommodation-bookings/{bookingId}:
 *   get:
 *     summary: Get accommodation booking by ID
 *     tags: [Accommodation Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/AccommodationBooking' }
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Booking not found
 */
router.get(
  '/accommodation-bookings/:bookingId',
  accommodationController.getBookingById
);

/**
 * @swagger
 * /api/accommodations/accommodation-bookings/{bookingId}:
 *   put:
 *     summary: Update an accommodation booking
 *     tags: [Accommodation Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               checkInDate: { type: string, format: date }
 *               checkOutDate: { type: string, format: date }
 *               totalGuests: { type: integer }
 *               specialRequests: { type: string }
 *               paymentStatus: { type: string, enum: [PENDING, PAID, REFUNDED, FAILED, PARTIALLY_PAID] }
 *               paymentMethod: { type: string, enum: [CASH, CARD, DIGITAL_WALLET, ONLINE_PAYMENT, VOUCHER] }
 *               bookingStatus: { type: string, enum: [PENDING, CONFIRMED, CANCELLED, CHECKED_IN, CHECKED_OUT, NO_SHOW] }
 *     responses:
 *       200:
 *         description: Booking updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Booking not found
 */
router.put(
  '/accommodation-bookings/:bookingId',
  validate(updateBookingSchema),
  accommodationController.updateBooking
);

/**
 * @swagger
 * /api/accommodations/accommodation-bookings/{bookingId}:
 *   delete:
 *     summary: Cancel an accommodation booking
 *     tags: [Accommodation Bookings]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Booking cancelled
 *       400:
 *         description: Booking already cancelled or cannot cancel
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Booking not found
 */
router.delete(
  '/accommodation-bookings/:bookingId',
  accommodationController.cancelBooking
);

// ==================== ADMIN ROUTES (SuperAdmin only) ====================

/**
 * @swagger
 * tags:
 *   name: Admin Accommodations
 *   description: SuperAdmin endpoints for accommodations
 */

/**
 * @swagger
 * /api/accommodations/admin/accommodations:
 *   get:
 *     summary: Get all accommodations (admin)
 *     tags: [Admin Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: isVerified
 *         schema: { type: boolean }
 *       - in: query
 *         name: isFeatured
 *         schema: { type: boolean }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, name, starRating, overallRating, city] }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of all accommodations with vendor info
 */
router.get(
  '/admin/accommodations',
  validate(adminAccommodationsQuerySchema, 'query'),
  accommodationController.adminGetAllAccommodations
);

/**
 * @swagger
 * /api/accommodations/admin/accommodations/{id}/verify:
 *   patch:
 *     summary: Verify/unverify an accommodation (admin)
 *     tags: [Admin Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isVerified
 *             properties:
 *               isVerified: { type: boolean }
 *     responses:
 *       200:
 *         description: Verification status updated
 */
router.patch(
  '/admin/accommodations/:id/verify',
  validate(adminVerifyAccommodationSchema),
  accommodationController.verifyAccommodation
);

/**
 * @swagger
 * /api/accommodations/admin/accommodations/{id}/feature:
 *   patch:
 *     summary: Feature/unfeature an accommodation (admin)
 *     tags: [Admin Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isFeatured
 *             properties:
 *               isFeatured: { type: boolean }
 *               featuredUntil: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Featured status updated
 */
router.patch(
  '/admin/accommodations/:id/feature',
  validate(adminFeatureAccommodationSchema),
  accommodationController.featureAccommodation
);

/**
 * @swagger
 * /api/accommodations/admin/accommodation-bookings:
 *   get:
 *     summary: Get all accommodation bookings (admin)
 *     tags: [Admin Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, CONFIRMED, CANCELLED, CHECKED_IN, CHECKED_OUT, NO_SHOW] }
 *       - in: query
 *         name: accommodationId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of all bookings
 */
router.get(
  '/admin/accommodation-bookings',
  validate(adminBookingsQuerySchema, 'query'),
  accommodationController.adminGetAllBookings
);

/**
 * @swagger
 * /api/accommodations/admin/accommodation-bookings/{bookingId}/status:
 *   patch:
 *     summary: Force update booking status (admin)
 *     tags: [Admin Accommodations]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookingStatus
 *             properties:
 *               bookingStatus: { type: string, enum: [PENDING, CONFIRMED, CANCELLED, CHECKED_IN, CHECKED_OUT, NO_SHOW] }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Booking status updated
 */
router.patch(
  '/admin/accommodation-bookings/:bookingId/status',
  validate(adminUpdateBookingStatusSchema),
  accommodationController.adminUpdateBookingStatus
);

module.exports = router;