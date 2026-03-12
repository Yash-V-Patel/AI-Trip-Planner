// routes/vendor.routes.js
const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendor.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  // Body schemas
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
  processPayoutSchema,
  // Query schemas
  analyticsQuerySchema,
  transactionsQuerySchema,
  payoutsQuerySchema,
  reviewsQuerySchema,
  adminVendorsQuerySchema,
  // Param schemas
  documentIdParamSchema,
  memberIdParamSchema,
  reviewIdParamSchema,
  vendorIdParamSchema,
  payoutIdParamSchema,
} = require('../schemas/vendor.schema');

// Test route (no auth required)
/**
 * @swagger
 * /vendor/test:
 *   get:
 *     summary: Test endpoint
 *     tags: [Vendor]
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.get('/test', (req, res) => {
  res.status(200).json({ success: true, message: "Hello World" });
});

// ==================== ALL VENDOR ROUTES REQUIRE AUTH ====================
router.use(authMiddleware.authenticate);

// ==================== VENDOR PROFILE ====================

/**
 * @swagger
 * /vendor/status:
 *   get:
 *     summary: Check vendor application status
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor status
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
 *                     userId:
 *                       type: string
 *                     message:
 *                       type: string
 *       401:
 *         description: Unauthorized
 */
router.get('/status', vendorController.checkVendorStatus);

/**
 * @swagger
 * /vendor/register:
 *   post:
 *     summary: Register as a vendor
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - businessName
 *               - vendorType
 *               - businessAddress
 *               - businessPhone
 *               - businessEmail
 *             properties:
 *               businessName:
 *                 type: string
 *                 maxLength: 255
 *               businessRegNumber:
 *                 type: string
 *                 maxLength: 100
 *               taxId:
 *                 type: string
 *                 maxLength: 50
 *               vendorType:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [ACCOMMODATION_PROVIDER, TRANSPORTATION_PROVIDER, TRAVEL_AGENCY, EXPERIENCE_PROVIDER, SHOPPING_VENDOR, RESTAURANT, OTHER]
 *                 minItems: 1
 *               businessAddress:
 *                 type: string
 *                 maxLength: 500
 *               businessPhone:
 *                 type: string
 *                 pattern: '^[0-9+\-\s()]{10,20}$'
 *               businessEmail:
 *                 type: string
 *                 format: email
 *                 maxLength: 255
 *               website:
 *                 type: string
 *                 format: uri
 *                 maxLength: 255
 *               description:
 *                 type: string
 *                 maxLength: 2000
 *               logo:
 *                 type: string
 *                 format: uri
 *               coverImage:
 *                 type: string
 *                 format: uri
 *               documents:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               additionalInfo:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       201:
 *         description: Vendor registration submitted
 *       400:
 *         description: Bad request (already registered, pending application)
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/register',
  validate(registerVendorSchema),
  vendorController.registerVendor
);

/**
 * @swagger
 * /vendor/profile:
 *   get:
 *     summary: Get vendor profile
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vendor profile data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get('/profile', vendorController.getVendorProfile);

/**
 * @swagger
 * /vendor/profile:
 *   put:
 *     summary: Update vendor profile
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               businessName:
 *                 type: string
 *                 maxLength: 255
 *               businessAddress:
 *                 type: string
 *                 maxLength: 500
 *               businessPhone:
 *                 type: string
 *                 pattern: '^[0-9+\-\s()]{10,20}$'
 *               businessEmail:
 *                 type: string
 *                 format: email
 *                 maxLength: 255
 *               website:
 *                 type: string
 *                 format: uri
 *                 maxLength: 255
 *               description:
 *                 type: string
 *                 maxLength: 2000
 *               logo:
 *                 type: string
 *                 format: uri
 *               coverImage:
 *                 type: string
 *                 format: uri
 *               facebookUrl:
 *                 type: string
 *                 format: uri
 *               instagramUrl:
 *                 type: string
 *                 format: uri
 *               twitterUrl:
 *                 type: string
 *                 format: uri
 *               linkedInUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.put(
  '/profile',
  validate(updateVendorProfileSchema),
  vendorController.updateVendorProfile
);

// ==================== DOCUMENT MANAGEMENT ====================

/**
 * @swagger
 * /vendor/documents:
 *   post:
 *     summary: Upload a document
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentType
 *               - documentUrl
 *             properties:
 *               documentType:
 *                 type: string
 *                 maxLength: 100
 *               documentUrl:
 *                 type: string
 *                 format: uri
 *               documentNumber:
 *                 type: string
 *                 maxLength: 100
 *               issueDate:
 *                 type: string
 *                 format: date
 *               expiryDate:
 *                 type: string
 *                 format: date
 *               issuingCountry:
 *                 type: string
 *                 maxLength: 100
 *               fileSize:
 *                 type: integer
 *               mimeType:
 *                 type: string
 *                 maxLength: 100
 *     responses:
 *       201:
 *         description: Document uploaded
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.post(
  '/documents',
  validate(documentUploadSchema),
  vendorController.uploadDocument
);

/**
 * @swagger
 * /vendor/documents:
 *   get:
 *     summary: Get all documents
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of documents
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get('/documents', vendorController.getDocuments);

/**
 * @swagger
 * /vendor/documents/{documentId}:
 *   delete:
 *     summary: Delete a document
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 */
router.delete(
  '/documents/:documentId',
  validate(documentIdParamSchema, 'params'),
  vendorController.deleteDocument
);

// ==================== TEAM MANAGEMENT ====================

/**
 * @swagger
 * /vendor/team:
 *   get:
 *     summary: Get team members
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of team members
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get('/team', vendorController.getTeamMembers);

/**
 * @swagger
 * /vendor/team:
 *   post:
 *     summary: Add a team member
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [ADMIN, MANAGER, EDITOR, VIEWER]
 *               permissions:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       201:
 *         description: Team member added
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor or user not found
 *       409:
 *         description: User already a team member
 */
router.post(
  '/team',
  validate(addTeamMemberSchema),
  vendorController.addTeamMember
);

/**
 * @swagger
 * /vendor/team/{memberId}:
 *   put:
 *     summary: Update a team member
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [ADMIN, MANAGER, EDITOR, VIEWER]
 *               permissions:
 *                 type: object
 *                 additionalProperties: true
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Team member updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Team member not found
 */
router.put(
  '/team/:memberId',
  validate(memberIdParamSchema, 'params'),
  validate(updateTeamMemberSchema),
  vendorController.updateTeamMember
);

/**
 * @swagger
 * /vendor/team/{memberId}:
 *   delete:
 *     summary: Remove a team member
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *         description: Team member ID
 *     responses:
 *       200:
 *         description: Team member removed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Team member not found
 */
router.delete(
  '/team/:memberId',
  validate(memberIdParamSchema, 'params'),
  vendorController.removeTeamMember
);

// ==================== DASHBOARD & ANALYTICS ====================

/**
 * @swagger
 * /vendor/dashboard:
 *   get:
 *     summary: Get vendor dashboard
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get('/dashboard', vendorController.getDashboard);

/**
 * @swagger
 * /vendor/analytics:
 *   get:
 *     summary: Get vendor analytics
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date (ISO)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: End date (ISO)
 *     responses:
 *       200:
 *         description: Analytics data
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get(
  '/analytics',
  validate(analyticsQuerySchema, 'query'),
  vendorController.getAnalytics
);

// ==================== FINANCIAL ====================

/**
 * @swagger
 * /vendor/transactions:
 *   get:
 *     summary: Get vendor transactions
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED, CANCELLED]
 *         description: Filter by status
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
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of transactions
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get(
  '/transactions',
  validate(transactionsQuerySchema, 'query'),
  vendorController.getTransactions
);

/**
 * @swagger
 * /vendor/payouts/request:
 *   post:
 *     summary: Request a payout
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - payoutMethod
 *               - payoutDetails
 *             properties:
 *               amount:
 *                 type: number
 *                 format: float
 *                 minimum: 0.01
 *               payoutMethod:
 *                 type: string
 *                 enum: [BANK_TRANSFER, PAYPAL, STRIPE]
 *               payoutDetails:
 *                 type: object
 *                 properties:
 *                   bankName:
 *                     type: string
 *                   accountNumber:
 *                     type: string
 *                   accountName:
 *                     type: string
 *                   routingNumber:
 *                     type: string
 *                   swiftCode:
 *                     type: string
 *                   paypalEmail:
 *                     type: string
 *                     format: email
 *                   stripeAccountId:
 *                     type: string
 *                 minProperties: 1
 *                 description: Conditional based on payoutMethod
 *     responses:
 *       201:
 *         description: Payout requested
 *       400:
 *         description: Validation error or insufficient balance
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.post(
  '/payouts/request',
  validate(payoutRequestSchema),
  vendorController.requestPayout
);

/**
 * @swagger
 * /vendor/payouts:
 *   get:
 *     summary: Get vendor payouts
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED]
 *         description: Filter by status
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
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of payouts
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get(
  '/payouts',
  validate(payoutsQuerySchema, 'query'),
  vendorController.getPayouts
);

// ==================== REVIEWS ====================

/**
 * @swagger
 * /vendor/reviews:
 *   get:
 *     summary: Get vendor reviews
 *     tags: [Vendor]
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
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of reviews with stats
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Vendor not found
 */
router.get(
  '/reviews',
  validate(reviewsQuerySchema, 'query'),
  vendorController.getReviews
);

/**
 * @swagger
 * /vendor/reviews/{reviewId}/reply:
 *   post:
 *     summary: Reply to a review
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *         description: Review ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - response
 *             properties:
 *               response:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Reply posted
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Review not found
 */
router.post(
  '/reviews/:reviewId/reply',
  validate(reviewIdParamSchema, 'params'),
  validate(replyToReviewSchema),
  vendorController.replyToReview
);

// ==================== ADMIN ROUTES ====================
// All admin routes require super-admin privileges
router.use('/admin', authMiddleware.requireSuperAdmin);

/**
 * @swagger
 * /admin/vendors:
 *   get:
 *     summary: Get all vendors (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [ACCOMMODATION_PROVIDER, TRANSPORTATION_PROVIDER, TRAVEL_AGENCY, EXPERIENCE_PROVIDER, SHOPPING_VENDOR, RESTAURANT, OTHER]
 *         description: Filter by vendor type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, DOCUMENTS_SUBMITTED, UNDER_REVIEW, VERIFIED, REJECTED]
 *         description: Filter by verification status
 *       - in: query
 *         name: verified
 *         schema:
 *           type: boolean
 *         description: Filter by verified flag
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by business name, email, or phone
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, businessName, verificationStatus, balance]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
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
 *           default: 20
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of vendors with pagination
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 */
router.get(
  '/admin/vendors',
  validate(adminVendorsQuerySchema, 'query'),
  vendorController.getAllVendors
);

/**
 * @swagger
 * /admin/vendors/{vendorId}:
 *   get:
 *     summary: Get vendor by ID (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     responses:
 *       200:
 *         description: Vendor details with related data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Vendor not found
 */
router.get(
  '/admin/vendors/:vendorId',
  validate(vendorIdParamSchema, 'params'),
  vendorController.getVendorById
);

/**
 * @swagger
 * /admin/application/pending:
 *   get:
 *     summary: Get pending vendor verifications (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending vendors
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 */
router.get(
  '/admin/application/pending',
  vendorController.getPendingVerifications
);

/**
 * @swagger
 * /admin/vendors/{vendorId}/verify:
 *   post:
 *     summary: Verify a vendor (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - approvedTypes
 *             properties:
 *               approvedTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [ACCOMMODATION_PROVIDER, TRANSPORTATION_PROVIDER, TRAVEL_AGENCY, EXPERIENCE_PROVIDER, SHOPPING_VENDOR, RESTAURANT, OTHER]
 *                 minItems: 1
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Vendor verified
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Vendor not found
 */
router.post(
  '/admin/vendors/:vendorId/verify',
  validate(vendorIdParamSchema, 'params'),
  validate(verifyVendorSchema),
  vendorController.verifyVendor
);

/**
 * @swagger
 * /admin/vendors/{vendorId}/suspend:
 *   post:
 *     summary: Suspend a vendor (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *               duration:
 *                 type: integer
 *                 description: Suspension duration in milliseconds (minimum 1 hour)
 *                 minimum: 3600000
 *     responses:
 *       200:
 *         description: Vendor suspended
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Vendor not found
 */
router.post(
  '/admin/vendors/:vendorId/suspend',
  validate(vendorIdParamSchema, 'params'),
  validate(suspendVendorSchema),
  vendorController.suspendVendor
);

/**
 * @swagger
 * /admin/vendors/{vendorId}/activate:
 *   post:
 *     summary: Activate a vendor (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     responses:
 *       200:
 *         description: Vendor activated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Vendor not found
 */
router.post(
  '/admin/vendors/:vendorId/activate',
  validate(vendorIdParamSchema, 'params'),
  vendorController.activateVendor
);

/**
 * @swagger
 * /admin/vendors/{vendorId}/commission:
 *   put:
 *     summary: Update vendor commission rate (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - commissionRate
 *             properties:
 *               commissionRate:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Commission percentage
 *     responses:
 *       200:
 *         description: Commission updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Vendor not found
 */
router.put(
  '/admin/vendors/:vendorId/commission',
  validate(vendorIdParamSchema, 'params'),
  validate(updateCommissionSchema),
  vendorController.updateCommission
);

/**
 * @swagger
 * /admin/payouts/{payoutId}/process:
 *   post:
 *     summary: Process a payout (admin)
 *     tags: [Vendor Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payoutId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payout ID
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
 *                 enum: [PROCESSING, COMPLETED, FAILED, CANCELLED]
 *               processorResponse:
 *                 type: object
 *               failureReason:
 *                 type: string
 *                 description: Required if status is FAILED
 *     responses:
 *       200:
 *         description: Payout processed
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not super-admin)
 *       404:
 *         description: Payout not found
 */
router.post(
  '/admin/payouts/:payoutId/process',
  validate(payoutIdParamSchema, 'params'),
  validate(processPayoutSchema),
  vendorController.processPayout
);

module.exports = router;