// routes/vendor-experience.routes.js
const express = require('express');
const router = express.Router();
const vendorExperienceController = require('../controllers/vendor-experience.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createExperienceSchema,
  updateExperienceSchema,
  toggleExperienceStatusSchema,
  searchExperiencesQuerySchema,
  availabilityQuerySchema,
  vendorExperiencesQuerySchema,
  experienceStatsParamsSchema,
  adminExperiencesQuerySchema,
  adminExperienceBookingsQuerySchema,
  adminVerifyExperienceSchema,
} = require('../schemas/experience.schema');

// ==================== PUBLIC ROUTES (no authentication) ====================

/**
 * @swagger
 * /api/experiences/search:
 *   get:
 *     summary: Search for experiences
 *     tags: [Experiences (Public)]
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         description: Filter by city name
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [SIGHTSEEING, DINING, ENTERTAINMENT, ADVENTURE, CULTURAL, RELAXATION, SHOPPING, OTHER] }
 *         description: Filter by category
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Full-text search in title/description
 *       - in: query
 *         name: minPrice
 *         schema: { type: number, minimum: 0 }
 *         description: Minimum price per person
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number, minimum: 0 }
 *         description: Maximum price per person
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, rating, pricePerPerson, city], default: createdAt }
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: skipCache
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: List of experiences
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Experience' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/search', validate(searchExperiencesQuerySchema, 'query'), vendorExperienceController.searchExperiences);

/**
 * @swagger
 * /api/experiences/city/{city}:
 *   get:
 *     summary: Get experiences by city
 *     tags: [Experiences (Public)]
 *     parameters:
 *       - in: path
 *         name: city
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: List of experiences in the city
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Experience' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/city/:city', vendorExperienceController.getExperiencesByCity);

/**
 * @swagger
 * /api/experiences/{experienceId}:
 *   get:
 *     summary: Get experience details by ID
 *     tags: [Experiences (Public)]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: skipCache
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Experience details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/ExperienceDetail' }
 */
router.get('/:experienceId', vendorExperienceController.getExperienceById);

/**
 * @swagger
 * /api/experiences/{experienceId}/availability:
 *   get:
 *     summary: Check availability for a specific date
 *     tags: [Experiences (Public)]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *         description: Date in YYYY-MM-DD format
 *     responses:
 *       200:
 *         description: Availability info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     available: { type: boolean }
 *                     remainingSpots: { type: number, nullable: true }
 *                     totalSpots: { type: number, nullable: true }
 *                     bookedCount: { type: number }
 */
router.get('/:experienceId/availability', validate(availabilityQuerySchema, 'query'), vendorExperienceController.checkAvailability);

// ==================== AUTHENTICATED ROUTES (vendor or team) ====================
router.use(authMiddleware.authenticate);

/**
 * @swagger
 * /api/vendor/experiences:
 *   post:
 *     summary: Create a new experience (vendor only)
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, pricePerPerson]
 *             properties:
 *               title: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 2000 }
 *               category: { type: string, enum: [SIGHTSEEING, DINING, ENTERTAINMENT, ADVENTURE, CULTURAL, RELAXATION, SHOPPING, OTHER] }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               address: { type: string, maxLength: 500 }
 *               duration: { oneOf: [{ type: number }, { type: string }] }
 *               pricePerPerson: { type: number, minimum: 0, multipleOf: 0.01 }
 *               childPrice: { type: number, minimum: 0, multipleOf: 0.01 }
 *               maxParticipants: { type: integer, minimum: 1 }
 *               minParticipants: { type: integer, minimum: 1 }
 *               languages: { type: array, items: { type: string } }
 *               includes: { type: array, items: { type: string } }
 *               excludes: { type: array, items: { type: string } }
 *               itinerary: { type: object }
 *               images: { type: array, items: { type: string, format: uri } }
 *               meetingPoint: { type: string, maxLength: 500 }
 *               tags: { type: array, items: { type: string } }
 *               currency: { type: string, minLength: 3, maxLength: 3, default: USD }
 *               isActive: { type: boolean, default: true }
 *               blackoutDates: { type: object, default: {} }
 *     responses:
 *       201:
 *         description: Experience created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Experience' }
 *                 message: { type: string }
 */
router.post('/', validate(createExperienceSchema), vendorExperienceController.createExperience);

/**
 * @swagger
 * /api/vendor/experiences:
 *   get:
 *     summary: Get vendor's own experiences (with pagination)
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *         description: Filter by active status
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: List of vendor's experiences
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Experience' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/', validate(vendorExperiencesQuerySchema, 'query'), vendorExperienceController.getMyExperiences);

/**
 * @swagger
 * /api/vendor/experiences/{experienceId}:
 *   put:
 *     summary: Update an experience (vendor only)
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 2000 }
 *               category: { type: string, enum: [SIGHTSEEING, DINING, ENTERTAINMENT, ADVENTURE, CULTURAL, RELAXATION, SHOPPING, OTHER] }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               address: { type: string, maxLength: 500 }
 *               duration: { oneOf: [{ type: number }, { type: string }] }
 *               pricePerPerson: { type: number, minimum: 0, multipleOf: 0.01 }
 *               childPrice: { type: number, minimum: 0, multipleOf: 0.01 }
 *               maxParticipants: { type: integer, minimum: 1 }
 *               minParticipants: { type: integer, minimum: 1 }
 *               languages: { type: array, items: { type: string } }
 *               includes: { type: array, items: { type: string } }
 *               excludes: { type: array, items: { type: string } }
 *               itinerary: { type: object }
 *               images: { type: array, items: { type: string, format: uri } }
 *               meetingPoint: { type: string, maxLength: 500 }
 *               tags: { type: array, items: { type: string } }
 *               currency: { type: string, minLength: 3, maxLength: 3 }
 *               isActive: { type: boolean }
 *               blackoutDates: { type: object }
 *     responses:
 *       200:
 *         description: Experience updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Experience' }
 *                 message: { type: string }
 */
router.put('/:experienceId', validate(updateExperienceSchema), vendorExperienceController.updateExperience);

/**
 * @swagger
 * /api/vendor/experiences/{experienceId}:
 *   delete:
 *     summary: Delete an experience (vendor only)
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Experience deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 */
router.delete('/:experienceId', vendorExperienceController.deleteExperience);

/**
 * @swagger
 * /api/vendor/experiences/{experienceId}/status:
 *   patch:
 *     summary: Toggle active status of an experience
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     title: { type: string }
 *                     isActive: { type: boolean }
 *                 message: { type: string }
 */
router.patch('/:experienceId/status', validate(toggleExperienceStatusSchema), vendorExperienceController.toggleExperienceStatus);

/**
 * @swagger
 * /api/vendor/experiences/{experienceId}/stats:
 *   get:
 *     summary: Get statistics for an experience
 *     tags: [Vendor Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Experience statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalBookings: { type: integer }
 *                     completedBookings: { type: integer }
 *                     cancelledBookings: { type: integer }
 *                     pendingBookings: { type: integer }
 *                     totalRevenue: { type: number }
 *                     conversionRate: { type: number }
 *                     monthlyBookings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           month: { type: string, format: date-time }
 *                           count: { type: integer }
 *                           revenue: { type: number }
 */
router.get('/:experienceId/stats', validate(experienceStatsParamsSchema, 'params'), vendorExperienceController.getExperienceStats);

// ==================== ADMIN ROUTES (superadmin only) ====================

/**
 * @swagger
 * /api/vendor/experiences/admin/experiences:
 *   get:
 *     summary: Get all experiences (admin only)
 *     tags: [Admin - Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [SIGHTSEEING, DINING, ENTERTAINMENT, ADVENTURE, CULTURAL, RELAXATION, SHOPPING, OTHER] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, rating, pricePerPerson, city], default: createdAt }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: List of all experiences with pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/ExperienceAdmin' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/admin/experiences', validate(adminExperiencesQuerySchema, 'query'), vendorExperienceController.adminGetAllExperiences);

/**
 * @swagger
 * /api/vendor/experiences/admin/experiences/{experienceId}/bookings:
 *   get:
 *     summary: Get all bookings for a specific experience (admin only)
 *     tags: [Admin - Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: List of bookings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       experienceDate: { type: string, format: date-time }
 *                       numberOfParticipants: { type: integer }
 *                       totalAmount: { type: number }
 *                       status: { type: string }
 *                       travelPlan: { type: object, properties: { id: { type: string }, title: { type: string } } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/admin/experiences/:experienceId/bookings', validate(adminExperienceBookingsQuerySchema, 'query'), vendorExperienceController.adminGetExperienceBookings);

/**
 * @swagger
 * /api/vendor/experiences/admin/experiences/{experienceId}/verify:
 *   patch:
 *     summary: Verify/unverify an experience (admin only)
 *     tags: [Admin - Experiences]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: experienceId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isVerified]
 *             properties:
 *               isVerified: { type: boolean }
 *     responses:
 *       200:
 *         description: Verification status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     title: { type: string }
 *                     isVerified: { type: boolean }
 *                 message: { type: string }
 */
router.patch('/admin/experiences/:experienceId/verify', validate(adminVerifyExperienceSchema), vendorExperienceController.adminVerifyExperience);

module.exports = router;