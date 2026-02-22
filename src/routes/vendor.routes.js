const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  vendorApplicationSchema,
  approveApplicationSchema,
  rejectApplicationSchema
} = require('../schemas/vendor.schema');

// All vendor routes require authentication
router.use(authMiddleware.authenticate);

// Public vendor routes (any authenticated user)
router.post(
  '/apply',
  validate(vendorApplicationSchema),
  vendorController.applyForVendor
);

router.get(
  '/application-status',
  vendorController.getApplicationStatus
);

// NEW: Get all applications for the logged-in user
router.get(
  '/my-applications',
  vendorController.getAllApplicationsForUser
);

// Protected vendor routes (vendors only)
router.get(
  '/status',
  vendorController.getVendorStatus
);

router.get(
  '/my-accommodations',
  vendorController.getMyAccommodations
);

// Admin routes (superadmin only)
router.get(
  '/admin/applications',
  authMiddleware.requireSuperAdmin,
  vendorController.getAllApplications
);

router.get(
  '/admin/applications/:applicationId',
  authMiddleware.requireSuperAdmin,
  vendorController.getApplicationById
);

router.post(
  '/admin/applications/:applicationId/approve',
  authMiddleware.requireSuperAdmin,
  validate(approveApplicationSchema),
  vendorController.approveApplication
);

router.post(
  '/admin/applications/:applicationId/reject',
  authMiddleware.requireSuperAdmin,
  validate(rejectApplicationSchema),
  vendorController.rejectApplication
);

router.get(
  '/admin/vendors',
  authMiddleware.requireSuperAdmin,
  vendorController.getAllVendors
);

module.exports = router;