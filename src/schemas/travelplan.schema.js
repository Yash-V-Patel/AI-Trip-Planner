const Joi = require('joi');

const travelPlanStatusEnum = ['PLANNING', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const experienceCategoryEnum = ['SIGHTSEEING', 'DINING', 'ENTERTAINMENT', 'ADVENTURE', 'CULTURAL', 'RELAXATION', 'SHOPPING', 'OTHER'];

const travelPlanSchema = Joi.object({
  title: Joi.string()
    .min(3)
    .max(200)
    .required()
    .messages({
      'string.min': 'Title must be at least 3 characters long',
      'string.max': 'Title cannot exceed 200 characters',
      'any.required': 'Title is required'
    }),
  
  destination: Joi.string()
    .min(2)
    .max(200)
    .required()
    .messages({
      'string.min': 'Destination must be at least 2 characters long',
      'string.max': 'Destination cannot exceed 200 characters',
      'any.required': 'Destination is required'
    }),
  
  description: Joi.string()
    .max(1000)
    .allow('')
    .messages({
      'string.max': 'Description cannot exceed 1000 characters'
    }),
  
  startDate: Joi.date()
    .iso()
    .required()
    .messages({
      'date.base': 'Please provide a valid start date',
      'any.required': 'Start date is required'
    }),
  
  endDate: Joi.date()
    .iso()
    .greater(Joi.ref('startDate'))
    .required()
    .messages({
      'date.greater': 'End date must be after start date',
      'any.required': 'End date is required'
    }),
  
  budget: Joi.number()
    .positive()
    .precision(2)
    .allow(null)
    .messages({
      'number.positive': 'Budget must be a positive number',
      'number.precision': 'Budget cannot have more than 2 decimal places'
    }),
  
  travelers: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(1)
    .messages({
      'number.min': 'At least 1 traveler is required',
      'number.max': 'Cannot exceed 100 travelers'
    }),
  
  interests: Joi.array()
    .items(Joi.string().max(50))
    .max(50),
  
  status: Joi.string()
    .valid(...travelPlanStatusEnum)
    .default('PLANNING')
    .messages({
      'any.only': `Status must be one of: ${travelPlanStatusEnum.join(', ')}`
    })
});

const travelPlanUpdateSchema = travelPlanSchema.fork(
  ['title', 'destination', 'startDate', 'endDate'],
  (field) => field.optional()
);

const sharePlanSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  
  permission: Joi.string()
    .valid('viewer', 'editor', 'suggester')
    .required()
    .messages({
      'any.only': 'Permission must be one of: viewer, editor, suggester',
      'any.required': 'Permission level is required'
    })
});

module.exports = {
  travelPlanSchema,
  travelPlanUpdateSchema,
  sharePlanSchema
};