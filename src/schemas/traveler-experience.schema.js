// Updated schemas file: schemas/traveler-experience.schema.js
const Joi = require('joi');

// Enums (matching controller expectations)
const experienceCategoryEnum = [
  'SIGHTSEEING', 'DINING', 'ENTERTAINMENT', 'ADVENTURE',
  'CULTURAL', 'RELAXATION', 'SHOPPING', 'OTHER'
];

const bookingStatusEnum = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];
const paymentMethodEnum = ['CASH', 'CARD', 'DIGITAL_WALLET', 'ONLINE_PAYMENT', 'VOUCHER'];

// ==================== PARAM SCHEMAS ====================
const travelPlanIdParamSchema = Joi.object({
  travelPlanId: Joi.string().required()
});

const customExperienceIdParamSchema = Joi.object({
  experienceId: Joi.string().required()
});

const bookingIdParamSchema = Joi.object({
  bookingId: Joi.string().required()
});

const vendorExperienceIdParamSchema = Joi.object({
  experienceId: Joi.string().required()
});

// ==================== BODY SCHEMAS ====================
const createCustomExperienceSchema = Joi.object({
  title: Joi.string().required().max(255),
  description: Joi.string().max(1000).allow(''),
  date: Joi.date().iso().required(),
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  location: Joi.string().max(500),
  cost: Joi.number().positive().precision(2).default(0),
  category: Joi.string().valid(...experienceCategoryEnum).default('SIGHTSEEING'),
  aiNotes: Joi.string().max(2000).allow('') // included because controller handles it
});

const bookVendorExperienceSchema = Joi.object({
  experienceId: Joi.string().required(),
  experienceDate: Joi.date().iso().required(),
  numberOfParticipants: Joi.number().integer().min(1).max(100).default(1),
  numberOfChildren: Joi.number().integer().min(0).max(50).default(0),
  leadGuestName: Joi.string().required().max(255),
  leadGuestEmail: Joi.string().email().required().max(255),
  leadGuestPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum)
});

const updateCustomExperienceSchema = Joi.object({
  title: Joi.string().max(255),
  description: Joi.string().max(1000).allow(''),
  date: Joi.date().iso(),
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  location: Joi.string().max(500),
  cost: Joi.number().positive().precision(2),
  category: Joi.string().valid(...experienceCategoryEnum),
  aiNotes: Joi.string().max(2000).allow('')
}).min(1);

const updateBookingSchema = Joi.object({
  experienceDate: Joi.date().iso(),
  numberOfParticipants: Joi.number().integer().min(1).max(100),
  numberOfChildren: Joi.number().integer().min(0).max(50),
  specialRequests: Joi.string().max(1000).allow(''),
  status: Joi.string().valid(...bookingStatusEnum),
  paymentStatus: Joi.string().valid('PENDING', 'PAID', 'REFUNDED', 'FAILED', 'PARTIALLY_PAID'),
  paymentMethod: Joi.string().valid(...paymentMethodEnum)
}).min(1);

const addReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(1000).required()
});

module.exports = {
  // Param schemas
  travelPlanIdParamSchema,
  customExperienceIdParamSchema,
  bookingIdParamSchema,
  vendorExperienceIdParamSchema,

  // Body schemas
  createCustomExperienceSchema,
  bookVendorExperienceSchema,
  updateCustomExperienceSchema,
  updateBookingSchema,
  addReviewSchema
};