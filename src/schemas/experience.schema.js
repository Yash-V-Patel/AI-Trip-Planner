// Updated schemas file: schemas/experience.schema.js
const Joi = require('joi');

// Enums (as used in controller / Prisma model)
const experienceCategoryEnum = [
  'SIGHTSEEING', 'DINING', 'ENTERTAINMENT', 'ADVENTURE',
  'CULTURAL', 'RELAXATION', 'SHOPPING', 'OTHER'
];
const bookingStatusEnum = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];
const sortFieldEnum = ['createdAt', 'rating', 'pricePerPerson', 'city'];

// ---------------------------------------------------------------------------
// Core Experience Schemas (match VendorExperience model + controller)
// ---------------------------------------------------------------------------

const createExperienceSchema = Joi.object({
  title: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  category: Joi.string().valid(...experienceCategoryEnum),
  city: Joi.string().max(100),
  country: Joi.string().max(100),
  address: Joi.string().max(500),
  duration: Joi.alternatives().try(
    Joi.number().positive(),
    Joi.string().max(50)
  ).optional(), // flexible – e.g., "3 hours", "Half day", 180 (minutes)
  pricePerPerson: Joi.number().positive().precision(2).required(),
  childPrice: Joi.number().positive().precision(2),
  maxParticipants: Joi.number().integer().min(1).max(1000),
  minParticipants: Joi.number().integer().min(1),
  languages: Joi.array().items(Joi.string().max(50)),
  includes: Joi.array().items(Joi.string().max(200)),
  excludes: Joi.array().items(Joi.string().max(200)),
  itinerary: Joi.object(), // flexible JSON structure
  images: Joi.array().items(Joi.string().uri()),
  meetingPoint: Joi.string().max(500),
  tags: Joi.array().items(Joi.string().max(50)),
  currency: Joi.string().length(3).default('USD'),
  isActive: Joi.boolean().default(true),
  blackoutDates: Joi.object().default({}), // e.g., { "2025-12-25": true }
});

const updateExperienceSchema = createExperienceSchema.fork(
  ['title', 'pricePerPerson'],
  (field) => field.optional()
);

const toggleExperienceStatusSchema = Joi.object({
  isActive: Joi.boolean().required()
});

// ---------------------------------------------------------------------------
// Query Validation Schemas
// ---------------------------------------------------------------------------

const searchExperiencesQuerySchema = Joi.object({
  city: Joi.string(),
  category: Joi.string().valid(...experienceCategoryEnum),
  search: Joi.string(),
  minPrice: Joi.number().positive().precision(2),
  maxPrice: Joi.number().positive().precision(2).greater(Joi.ref('minPrice')),
  sortBy: Joi.string().valid(...sortFieldEnum).default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  skipCache: Joi.boolean().default(false)
}).with('minPrice', 'maxPrice'); // both or none

const availabilityQuerySchema = Joi.object({
  date: Joi.date().iso().required()
});

const vendorExperiencesQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'inactive'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const experienceStatsParamsSchema = Joi.object({
  experienceId: Joi.string().required()
});

// ---------------------------------------------------------------------------
// Admin Schemas
// ---------------------------------------------------------------------------

const adminExperiencesQuerySchema = Joi.object({
  vendorId: Joi.string(),
  isActive: Joi.boolean(),
  city: Joi.string(),
  category: Joi.string().valid(...experienceCategoryEnum),
  search: Joi.string(),
  sortBy: Joi.string().valid(...sortFieldEnum).default('createdAt'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminExperienceBookingsQuerySchema = Joi.object({
  status: Joi.string().valid(...bookingStatusEnum),
  from: Joi.date().iso(),
  to: Joi.date().iso().greater(Joi.ref('from')),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminVerifyExperienceSchema = Joi.object({
  isVerified: Joi.boolean().required()
});

module.exports = {
  // Core
  createExperienceSchema,
  updateExperienceSchema,
  toggleExperienceStatusSchema,
  // Public queries
  searchExperiencesQuerySchema,
  availabilityQuerySchema,
  // Vendor queries
  vendorExperiencesQuerySchema,
  experienceStatsParamsSchema,
  // Admin
  adminExperiencesQuerySchema,
  adminExperienceBookingsQuerySchema,
  adminVerifyExperienceSchema,
};