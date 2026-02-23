const express = require('express');
const router = express.Router();
const travelerExperienceController = require('../controllers/traveler-experience.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createCustomExperienceSchema,
  bookVendorExperienceSchema,
  updateCustomExperienceSchema,
  updateBookingSchema,
  addReviewSchema
} = require('../schemas/traveler-experience.schema');

// Public routes (no auth required for browsing)
router.get('/vendor/:experienceId', travelerExperienceController.getExperienceDetails);

// Protected routes
router.use(authMiddleware.authenticate);

// Travel plan experiences
router.post(
  '/travel-plans/:travelPlanId/experiences/custom',
  validate(createCustomExperienceSchema),
  travelerExperienceController.addCustomExperience
);

router.post(
  '/travel-plans/:travelPlanId/experiences/book',
  validate(bookVendorExperienceSchema),
  travelerExperienceController.bookVendorExperience
);

router.get(
  '/travel-plans/:travelPlanId/experiences',
  travelerExperienceController.getTravelPlanExperiences
);

// Update/delete custom experiences
router.put(
  '/travel-plans/experiences/custom/:experienceId',
  validate(updateCustomExperienceSchema),
  travelerExperienceController.updateCustomExperience
);

router.delete(
  '/travel-plans/experiences/custom/:experienceId',
  travelerExperienceController.deleteCustomExperience
);

// Manage bookings
router.put(
  '/travel-plans/experiences/booking/:bookingId',
  validate(updateBookingSchema),
  travelerExperienceController.updateBooking
);

router.delete(
  '/travel-plans/experiences/booking/:bookingId',
  travelerExperienceController.cancelBooking
);

// Reviews
router.post(
  '/booking/:bookingId/review',
  validate(addReviewSchema),
  travelerExperienceController.addExperienceReview
);

module.exports = router;