const Joi = require('joi');

const experienceCategoryEnum = [
  'SIGHTSEEING', 'DINING', 'ENTERTAINMENT', 'ADVENTURE', 
  'CULTURAL', 'RELAXATION', 'SHOPPING', 'OTHER'
];

const createExperienceSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  category: Joi.string().valid(...experienceCategoryEnum).required(),
  location: Joi.string().required().max(500),
  city: Joi.string().required().max(100),
  country: Joi.string().required().max(100),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
  meetingPoint: Joi.string().max(500),
  pricePerPerson: Joi.number().positive().precision(2).required(),
  childPrice: Joi.number().positive().precision(2),
  groupDiscount: Joi.object(),
  durationHours: Joi.number().positive().required(),
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/),
  minParticipants: Joi.number().integer().min(1).default(1),
  maxParticipants: Joi.number().integer().min(1).max(100).default(20),
  includes: Joi.array().items(Joi.string()),
  excludes: Joi.array().items(Joi.string()),
  whatToBring: Joi.array().items(Joi.string()),
  restrictions: Joi.string(),
  images: Joi.array().items(Joi.string().uri()),
  video: Joi.string().uri(),
  availableDays: Joi.array().items(
    Joi.string().valid('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
  ),
  availableDates: Joi.object(),
  blackoutDates: Joi.object(),
  isActive: Joi.boolean().default(true)
});

const updateExperienceSchema = createExperienceSchema.fork(
  ['name', 'category', 'pricePerPerson'],
  (field) => field.optional()
);

module.exports = {
  createExperienceSchema,
  updateExperienceSchema
};