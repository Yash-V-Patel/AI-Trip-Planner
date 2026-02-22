const Joi = require('joi');

const genderEnum = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'];
const travelStyleEnum = ['LUXURY', 'BUDGET', 'ADVENTURE', 'RELAXATION', 'CULTURAL', 'BUSINESS', 'FAMILY_FRIENDLY', 'BACKPACKING'];
const travelCompanionEnum = ['SOLO', 'COUPLE', 'FAMILY', 'FRIENDS', 'GROUP_TOUR', 'BUSINESS_COLLEAGUES'];
const accountStatusEnum = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'BANNED'];

const profileSchema = Joi.object({
  // Personal Information
  dateOfBirth: Joi.date()
    .iso()
    .max('now')
    .messages({
      'date.max': 'Date of birth cannot be in the future'
    }),
  
  gender: Joi.string()
    .valid(...genderEnum)
    .messages({
      'any.only': `Gender must be one of: ${genderEnum.join(', ')}`
    }),
  
  nationality: Joi.string()
    .max(100),
  
  profilePicture: Joi.string()
    .uri()
    .max(500)
    .messages({
      'string.uri': 'Profile picture must be a valid URL'
    }),
  
  bio: Joi.string()
    .max(500)
    .messages({
      'string.max': 'Bio cannot exceed 500 characters'
    }),

  // Contact Information
  address: Joi.string()
    .max(255),
  
  city: Joi.string()
    .max(100),
  
  country: Joi.string()
    .max(100),
  
  postalCode: Joi.string()
    .max(20),
  
  emergencyContactName: Joi.string()
    .max(100),
  
  emergencyContactPhone: Joi.string()
    .pattern(/^[0-9+\-\s()]{10,20}$/)
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    }),
  
  emergencyContactRelation: Joi.string()
    .max(50),

  // Preferences
  language: Joi.string()
    .length(2)
    .default('en')
    .messages({
      'string.length': 'Language must be a 2-letter code'
    }),
  
  currency: Joi.string()
    .length(3)
    .default('USD')
    .messages({
      'string.length': 'Currency must be a 3-letter code'
    }),
  
  timezone: Joi.string()
    .max(50),

  // Travel Preferences
  dietaryRestrictions: Joi.array()
    .items(Joi.string().max(50))
    .max(20),
  
  mobilityNeeds: Joi.array()
    .items(Joi.string().max(50))
    .max(10),
  
  accessibilityNeeds: Joi.array()
    .items(Joi.string().max(50))
    .max(10),
  
  preferredTravelStyle: Joi.string()
    .valid(...travelStyleEnum)
    .messages({
      'any.only': `Travel style must be one of: ${travelStyleEnum.join(', ')}`
    }),
  
  travelCompanionPref: Joi.string()
    .valid(...travelCompanionEnum)
    .messages({
      'any.only': `Travel companion preference must be one of: ${travelCompanionEnum.join(', ')}`
    }),
  
  interests: Joi.array()
    .items(Joi.string().max(50))
    .max(50),

  // Communication Preferences
  emailNotifications: Joi.boolean()
    .default(true),
  
  pushNotifications: Joi.boolean()
    .default(true),
  
  smsNotifications: Joi.boolean()
    .default(false),
  
  marketingEmails: Joi.boolean()
    .default(false),

  // Social Media Links
  twitterHandle: Joi.string()
    .max(50)
    .pattern(/^@?(\w){1,15}$/)
    .messages({
      'string.pattern.base': 'Please provide a valid Twitter handle'
    }),
  
  instagramHandle: Joi.string()
    .max(50)
    .pattern(/^@?([\w.]){1,30}$/)
    .messages({
      'string.pattern.base': 'Please provide a valid Instagram handle'
    }),
  
  facebookProfile: Joi.string()
    .uri()
    .max(200)
    .messages({
      'string.uri': 'Please provide a valid Facebook profile URL'
    }),
  
  linkedInProfile: Joi.string()
    .uri()
    .max(200)
    .messages({
      'string.uri': 'Please provide a valid LinkedIn profile URL'
    }),

  // Statistics
  totalTripsPlanned: Joi.number()
    .integer()
    .min(0)
    .default(0),
  
  totalTripsCompleted: Joi.number()
    .integer()
    .min(0)
    .default(0),
  
  countriesVisited: Joi.array()
    .items(Joi.string().max(100))
    .max(300),
  
  favoriteDestinations: Joi.array()
    .items(Joi.string().max(100))
    .max(50)
});

const profileUpdateSchema = profileSchema.fork(
  ['language', 'currency', 'emailNotifications', 'pushNotifications', 'smsNotifications', 'marketingEmails'],
  (field) => field.optional()
);

module.exports = {
  profileSchema,
  profileUpdateSchema
};