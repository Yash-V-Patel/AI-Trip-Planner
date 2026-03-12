// Updated routes file: routes/vendor-experience.routes.js
const express = require('express');
const router = express.Router();
const vendorExperienceController = require('../controllers/vendor-experience.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  // Core schemas
  createExperienceSchema,
  updateExperienceSchema,
  toggleExperienceStatusSchema,
  // Query schemas
  searchExperiencesQuerySchema,
  availabilityQuerySchema,
  vendorExperiencesQuerySchema,
  experienceStatsParamsSchema,
  // Admin schemas
  adminExperiencesQuerySchema,
  adminExperienceBookingsQuerySchema,
  adminVerifyExperienceSchema,
} = require('../schemas/experience.schema');

// ==================== PUBLIC ROUTES (no authentication) ====================
router.get('/search', validate(searchExperiencesQuerySchema, 'query'), vendorExperienceController.searchExperiences);
router.get('/city/:city', vendorExperienceController.getExperiencesByCity);
router.get('/:experienceId', vendorExperienceController.getExperienceById);
router.get('/:experienceId/availability', validate(availabilityQuerySchema, 'query'), vendorExperienceController.checkAvailability);

// ==================== AUTHENTICATED ROUTES (vendor or team) ====================
router.use(authMiddleware.authenticate);

// Vendor experience management
router.post(
  '/',
  validate(createExperienceSchema),
  vendorExperienceController.createExperience
);

router.get(
  '/',
  validate(vendorExperiencesQuerySchema, 'query'),
  vendorExperienceController.getMyExperiences
);

router.put(
  '/:experienceId',
  validate(updateExperienceSchema),
  vendorExperienceController.updateExperience
);

router.delete('/:experienceId', vendorExperienceController.deleteExperience);

router.patch(
  '/:experienceId/status',
  validate(toggleExperienceStatusSchema),
  vendorExperienceController.toggleExperienceStatus
);

router.get(
  '/:experienceId/stats',
  validate(experienceStatsParamsSchema, 'params'),
  vendorExperienceController.getExperienceStats
);

// ==================== ADMIN ROUTES (superadmin only) ====================
router.get(
  '/admin/experiences',
  validate(adminExperiencesQuerySchema, 'query'),
  vendorExperienceController.adminGetAllExperiences
);

router.get(
  '/admin/experiences/:experienceId/bookings',
  validate(adminExperienceBookingsQuerySchema, 'query'),
  vendorExperienceController.adminGetExperienceBookings
);

router.patch(
  '/admin/experiences/:experienceId/verify',
  validate(adminVerifyExperienceSchema),
  vendorExperienceController.adminVerifyExperience
);

module.exports = router;