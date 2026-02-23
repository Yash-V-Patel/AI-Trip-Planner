const express = require('express');
const router = express.Router();
const vendorExperienceController = require('../controllers/vendor-experience.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createExperienceSchema,
  updateExperienceSchema
} = require('../schemas/experience.schema');

// All routes require authentication
router.use(authMiddleware.authenticate);

// Vendor experience management
router.post(
  '/',
  validate(createExperienceSchema),
  vendorExperienceController.createExperience
);

router.get('/', vendorExperienceController.getMyExperiences);

router.get('/:experienceId/stats', vendorExperienceController.getExperienceStats);

router.put(
  '/:experienceId',
  validate(updateExperienceSchema),
  vendorExperienceController.updateExperience
);

router.delete('/:experienceId', vendorExperienceController.deleteExperience);

module.exports = router;