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

// Register vendor schema
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

// Update vendor profile schema
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

// Document upload schema
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

// Add team member schema
const addTeamMemberSchema = Joi.object({
  email: Joi.string().email().required(),
  role: Joi.string().valid(...teamRoleEnum).required(),
  permissions: Joi.object()
});

// Update team member schema
const updateTeamMemberSchema = Joi.object({
  role: Joi.string().valid(...teamRoleEnum),
  permissions: Joi.object(),
  isActive: Joi.boolean()
}).min(1);

// Payout request schema
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

// Reply to review schema
const replyToReviewSchema = Joi.object({
  response: Joi.string().required().max(1000)
});

// Admin: Verify vendor schema
const verifyVendorSchema = Joi.object({
  approvedTypes: Joi.array().items(Joi.string().valid(...vendorTypeEnum)).min(1).required(),
  notes: Joi.string().max(500).allow('')
});

// Admin: Suspend vendor schema
const suspendVendorSchema = Joi.object({
  reason: Joi.string().required().max(500),
  duration: Joi.number().integer().min(3600000) // Minimum 1 hour in ms
});

// Admin: Update commission schema
const updateCommissionSchema = Joi.object({
  commissionRate: Joi.number().min(0).max(100).precision(2).required()
});

// Admin: Process payout schema
const processPayoutSchema = Joi.object({
  status: Joi.string().valid('PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED').required(),
  processorResponse: Joi.object(),
  failureReason: Joi.string().when('status', { is: 'FAILED', then: Joi.required() })
});

module.exports = {
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
};