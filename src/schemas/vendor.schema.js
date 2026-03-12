// Updated schemas file: schemas/vendor.schema.js
const Joi = require('joi');

const vendorTypeEnum = [
  'ACCOMMODATION_PROVIDER',
  'TRANSPORTATION_PROVIDER',
  'TRAVEL_AGENCY',
  'EXPERIENCE_PROVIDER',
  'SHOPPING_VENDOR',
  'RESTAURANT',
  'OTHER'
];

const teamRoleEnum = ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'];
const payoutMethodEnum = ['BANK_TRANSFER', 'PAYPAL', 'STRIPE'];
const payoutStatusEnum = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const transactionStatusEnum = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'];

// ==================== BODY SCHEMAS ====================

const registerVendorSchema = Joi.object({
  businessName: Joi.string().required().max(255),
  businessRegNumber: Joi.string().max(100).allow(''),
  taxId: Joi.string().max(50).allow(''),
  vendorType: Joi.array().items(Joi.string().valid(...vendorTypeEnum)).min(1).required(),
  businessAddress: Joi.string().required().max(500),
  businessPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/).required(),
  businessEmail: Joi.string().email().required().max(255),
  website: Joi.string().uri().max(255).allow(''),
  description: Joi.string().max(2000).allow(''),
  logo: Joi.string().uri().allow(''),
  coverImage: Joi.string().uri().allow(''),
  documents: Joi.array().items(Joi.string().uri()),
  additionalInfo: Joi.string().max(1000).allow('')
});

const updateVendorProfileSchema = Joi.object({
  businessName: Joi.string().max(255),
  businessAddress: Joi.string().max(500),
  businessPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  businessEmail: Joi.string().email().max(255),
  website: Joi.string().uri().max(255).allow(''),
  description: Joi.string().max(2000).allow(''),
  logo: Joi.string().uri().allow(''),
  coverImage: Joi.string().uri().allow(''),
  facebookUrl: Joi.string().uri().allow(''),
  instagramUrl: Joi.string().uri().allow(''),
  twitterUrl: Joi.string().uri().allow(''),
  linkedInUrl: Joi.string().uri().allow('')
}).min(1);

const documentUploadSchema = Joi.object({
  documentType: Joi.string().required().max(100),
  documentUrl: Joi.string().uri().required(),
  documentNumber: Joi.string().max(100).allow(''),
  issueDate: Joi.date().iso(),
  expiryDate: Joi.date().iso().greater(Joi.ref('issueDate')),
  issuingCountry: Joi.string().max(100),
  fileSize: Joi.number().integer(),
  mimeType: Joi.string().max(100)
});

const addTeamMemberSchema = Joi.object({
  email: Joi.string().email().required(),
  role: Joi.string().valid(...teamRoleEnum).required(),
  permissions: Joi.object()
});

const updateTeamMemberSchema = Joi.object({
  role: Joi.string().valid(...teamRoleEnum),
  permissions: Joi.object(),
  isActive: Joi.boolean()
}).min(1);

const payoutRequestSchema = Joi.object({
  amount: Joi.number().positive().precision(2).required(),
  payoutMethod: Joi.string().valid(...payoutMethodEnum).required(),
  payoutDetails: Joi.object({
    bankName: Joi.string().when('payoutMethod', { is: 'BANK_TRANSFER', then: Joi.required() }),
    accountNumber: Joi.string().when('payoutMethod', { is: 'BANK_TRANSFER', then: Joi.required() }),
    accountName: Joi.string().when('payoutMethod', { is: 'BANK_TRANSFER', then: Joi.required() }),
    routingNumber: Joi.string().when('payoutMethod', { is: 'BANK_TRANSFER', then: Joi.required() }),
    swiftCode: Joi.string().when('payoutMethod', { is: 'BANK_TRANSFER', then: Joi.required() }),
    paypalEmail: Joi.string().email().when('payoutMethod', { is: 'PAYPAL', then: Joi.required() }),
    stripeAccountId: Joi.string().when('payoutMethod', { is: 'STRIPE', then: Joi.required() })
  }).required()
});

const replyToReviewSchema = Joi.object({
  response: Joi.string().required().max(1000)
});

const verifyVendorSchema = Joi.object({
  approvedTypes: Joi.array().items(Joi.string().valid(...vendorTypeEnum)).min(1).required(),
  notes: Joi.string().max(500).allow('')
});

const suspendVendorSchema = Joi.object({
  reason: Joi.string().required().max(500),
  duration: Joi.number().integer().min(3600000) // Minimum 1 hour in ms
});

const updateCommissionSchema = Joi.object({
  commissionRate: Joi.number().min(0).max(100).precision(2).required()
});

const processPayoutSchema = Joi.object({
  status: Joi.string().valid('PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED').required(),
  processorResponse: Joi.object(),
  failureReason: Joi.string().when('status', { is: 'FAILED', then: Joi.required() })
});

// ==================== QUERY SCHEMAS ====================

const analyticsQuerySchema = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso().greater(Joi.ref('from'))
});

const transactionsQuerySchema = Joi.object({
  status: Joi.string().valid(...transactionStatusEnum),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const payoutsQuerySchema = Joi.object({
  status: Joi.string().valid(...payoutStatusEnum),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const reviewsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

const adminVendorsQuerySchema = Joi.object({
  type: Joi.string().valid(...vendorTypeEnum),
  status: Joi.string().valid('PENDING', 'DOCUMENTS_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'),
  verified: Joi.boolean(),
  isActive: Joi.boolean(),
  search: Joi.string().max(100),
  sortBy: Joi.string().valid('createdAt', 'businessName', 'verificationStatus', 'balance'),
  sortOrder: Joi.string().valid('asc', 'desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// ==================== PARAM SCHEMAS ====================

const documentIdParamSchema = Joi.object({
  documentId: Joi.string().required()
});

const memberIdParamSchema = Joi.object({
  memberId: Joi.string().required()
});

const reviewIdParamSchema = Joi.object({
  reviewId: Joi.string().required()
});

const vendorIdParamSchema = Joi.object({
  vendorId: Joi.string().required()
});

const payoutIdParamSchema = Joi.object({
  payoutId: Joi.string().required()
});

module.exports = {
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
  payoutIdParamSchema
};