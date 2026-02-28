const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  registerVendorSchema,
  updateVendorProfileSchema,
  documentUploadSchema,
  addTeamMemberSchema,
  updateTeamMemberSchema,
  payoutRequestSchema,
  replyToReviewSchema,
  verifyVendorSchema,
  suspendVendorSchema,
  updateCommissionSchema,
  processPayoutSchema
} = require('../schemas/vendor.schema');

router.get('/test', (req, res) => {
  res.status(200).json({
    success: true,
    message: "Hello World"
  });
})


// ==================== ALL VENDOR ROUTES REQUIRE AUTH ====================
router.use(authMiddleware.authenticate);

// ==================== VENDOR PROFILE ====================

router.get('/status', vendorController.checkVendorStatus);
/**
 * Register as a vendor
 * POST /api/vendor/register
 */

router.post(
  '/register',
  validate(registerVendorSchema),
  vendorController.registerVendor
);

/**
 * Get vendor profile
 * GET /api/vendor/profile
 */
router.get('/profile', vendorController.getVendorProfile);

/**
 * Update vendor profile
 * PUT /api/vendor/profile
 */
router.put(
  '/profile',
  validate(updateVendorProfileSchema),
  vendorController.updateVendorProfile
);

// ==================== DOCUMENT MANAGEMENT ====================

/**
 * Upload document
 * POST /api/vendor/documents
 */
router.post(
  '/documents',
  validate(documentUploadSchema),
  vendorController.uploadDocument
);

/**
 * Get all documents
 * GET /api/vendor/documents
 */
router.get('/documents', vendorController.getDocuments);

/**
 * Delete document
 * DELETE /api/vendor/documents/:documentId
 */
router.delete('/documents/:documentId', vendorController.deleteDocument);

// ==================== TEAM MANAGEMENT ====================

/**
 * Get team members
 * GET /api/vendor/team
 */
router.get('/team', vendorController.getTeamMembers);

/**
 * Add team member
 * POST /api/vendor/team
 */
router.post(
  '/team',
  validate(addTeamMemberSchema),
  vendorController.addTeamMember
);

/**
 * Update team member
 * PUT /api/vendor/team/:memberId
 */
router.put(
  '/team/:memberId',
  validate(updateTeamMemberSchema),
  vendorController.updateTeamMember
);

/**
 * Remove team member
 * DELETE /api/vendor/team/:memberId
 */
router.delete('/team/:memberId', vendorController.removeTeamMember);

// ==================== DASHBOARD & ANALYTICS ====================

/**
 * Get vendor dashboard
 * GET /api/vendor/dashboard
 */
router.get('/dashboard', vendorController.getDashboard);

/**
 * Get vendor analytics
 * GET /api/vendor/analytics
 */
router.get('/analytics', vendorController.getAnalytics);

// ==================== FINANCIAL ====================

/**
 * Get transactions
 * GET /api/vendor/transactions
 */
router.get('/transactions', vendorController.getTransactions);

/**
 * Request payout
 * POST /api/vendor/payouts/request
 */
router.post(
  '/payouts/request',
  validate(payoutRequestSchema),
  vendorController.requestPayout
);

/**
 * Get payouts
 * GET /api/vendor/payouts
 */
router.get('/payouts', vendorController.getPayouts);

// ==================== REVIEWS ====================

/**
 * Get vendor reviews
 * GET /api/vendor/reviews
 */
router.get('/reviews', vendorController.getReviews);

/**
 * Reply to review
 * POST /api/vendor/reviews/:reviewId/reply
 */
router.post(
  '/reviews/:reviewId/reply',
  validate(replyToReviewSchema),
  vendorController.replyToReview
);

// ==================== ADMIN ROUTES ====================

/**
 * Get all vendors (admin)
 * GET /api/admin/vendors
 */
router.get(
  '/admin/vendors',
  authMiddleware.requireSuperAdmin,
  vendorController.getAllVendors
);

/**
 * Get vendor by ID (admin)
 * GET /api/admin/vendors/:vendorId
 */
router.get(
  '/admin/vendors/:vendorId',
  authMiddleware.requireSuperAdmin,
  vendorController.getVendorById
);

/**
 * Get pending verifications (admin)
 * GET /api/admin/vendors/pending
 */
router.get(
  '/admin/application/pending',
  authMiddleware.requireSuperAdmin,
  vendorController.getPendingVerifications
);

/**
 * Verify vendor (admin)
 * POST /api/admin/vendors/:vendorId/verify
 */
router.post(
  '/admin/vendors/:vendorId/verify',
  authMiddleware.requireSuperAdmin,
  validate(verifyVendorSchema),
  vendorController.verifyVendor
);

/**
 * Suspend vendor (admin)
 * POST /api/admin/vendors/:vendorId/suspend
 */
router.post(
  '/admin/vendors/:vendorId/suspend',
  authMiddleware.requireSuperAdmin,
  validate(suspendVendorSchema),
  vendorController.suspendVendor
);

/**
 * Activate vendor (admin)
 * POST /api/admin/vendors/:vendorId/activate
 */
router.post(
  '/admin/vendors/:vendorId/activate',
  authMiddleware.requireSuperAdmin,
  vendorController.activateVendor
);

/**
 * Update commission (admin)
 * PUT /api/admin/vendors/:vendorId/commission
 */
router.put(
  '/admin/vendors/:vendorId/commission',
  authMiddleware.requireSuperAdmin,
  validate(updateCommissionSchema),
  vendorController.updateCommission
);

/**
 * Process payout (admin)
 * POST /api/admin/payouts/:payoutId/process
 */
router.post(
  '/admin/payouts/:payoutId/process',
  authMiddleware.requireSuperAdmin,
  validate(processPayoutSchema),
  vendorController.processPayout
);



module.exports = router;