const Joi = require('joi');

// Enums
const travelPlanStatusEnum = ['PLANNING', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const experienceCategoryEnum = ['SIGHTSEEING', 'DINING', 'ENTERTAINMENT', 'ADVENTURE', 'CULTURAL', 'RELAXATION', 'SHOPPING', 'OTHER'];
const roomTypeEnum = ['SINGLE', 'DOUBLE', 'TWIN', 'TRIPLE', 'SUITE', 'DELUXE', 'FAMILY', 'PRESIDENTIAL'];
const bookingStatusEnum = ['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW'];
const paymentStatusEnum = ['PENDING', 'PAID', 'REFUNDED', 'FAILED', 'PARTIALLY_PAID'];
const paymentMethodEnum = ['CASH', 'CARD', 'DIGITAL_WALLET', 'ONLINE_PAYMENT', 'VOUCHER'];
const transportationServiceTypeEnum = ['TAXI', 'BUS', 'TRAIN', 'FLIGHT', 'FERRY', 'CAR_RENTAL', 'BICYCLE', 'WALKING', 'OTHER'];
const transportationStatusEnum = ['BOOKED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'CANCELLED', 'DELAYED', 'COMPLETED'];
const shoppingVisitStatusEnum = ['PLANNED', 'VISITED', 'SKIPPED', 'CANCELLED'];

// ==================== CORE TRAVEL PLAN SCHEMAS ====================

const createTravelPlanSchema = Joi.object({
  title: Joi.string().required().min(3).max(200).messages({
    'string.min': 'Title must be at least 3 characters long',
    'string.max': 'Title cannot exceed 200 characters',
    'any.required': 'Title is required'
  }),
  destination: Joi.string().required().min(2).max(200).messages({
    'string.min': 'Destination must be at least 2 characters long',
    'string.max': 'Destination cannot exceed 200 characters',
    'any.required': 'Destination is required'
  }),
  description: Joi.string().max(1000).allow('').messages({
    'string.max': 'Description cannot exceed 1000 characters'
  }),
  startDate: Joi.date().iso().required().messages({
    'date.base': 'Please provide a valid start date',
    'any.required': 'Start date is required'
  }),
  endDate: Joi.date().iso().greater(Joi.ref('startDate')).required().messages({
    'date.greater': 'End date must be after start date',
    'any.required': 'End date is required'
  }),
  budget: Joi.number().positive().precision(2).allow(null).messages({
    'number.positive': 'Budget must be a positive number',
    'number.precision': 'Budget cannot have more than 2 decimal places'
  }),
  travelers: Joi.number().integer().min(1).max(100).default(1).messages({
    'number.min': 'At least 1 traveler is required',
    'number.max': 'Cannot exceed 100 travelers'
  }),
  interests: Joi.array().items(Joi.string().max(50)).max(50),
  status: Joi.string().valid(...travelPlanStatusEnum).default('PLANNING')
});

const updateTravelPlanSchema = createTravelPlanSchema.fork(
  ['title', 'destination', 'startDate', 'endDate'],
  (field) => field.optional()
);

const sharePlanSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required'
  }),
  permission: Joi.string().valid('viewer', 'editor', 'suggester').required().messages({
    'any.only': 'Permission must be one of: viewer, editor, suggester',
    'any.required': 'Permission level is required'
  })
});

const generateItinerarySchema = Joi.object({
  preferences: Joi.object({
    pace: Joi.string().valid('relaxed', 'moderate', 'intensive'),
    interests: Joi.array().items(Joi.string()),
    dietary: Joi.array().items(Joi.string()),
    mobility: Joi.string().valid('easy', 'moderate', 'challenging')
  })
});

const duplicatePlanSchema = Joi.object({
  title: Joi.string().min(3).max(200),
  startDate: Joi.date().iso()
});

const updateBudgetSchema = Joi.object({
  budget: Joi.number().positive().precision(2).required().messages({
    'number.positive': 'Budget must be a positive number',
    'any.required': 'Budget is required'
  })
});

const exportQuerySchema = Joi.object({
  format: Joi.string().valid('json', 'pdf').default('json')
});

// ==================== ACCOMMODATION BOOKING SCHEMAS ====================

const accommodationBookingSchema = Joi.object({
  checkInDate: Joi.date().iso().required(),
  checkOutDate: Joi.date().iso().greater(Joi.ref('checkInDate')).required(),
  totalGuests: Joi.number().integer().min(1).max(20).default(1),
  roomType: Joi.string().valid(...roomTypeEnum).required(),
  selectedRoomNumbers: Joi.array().items(Joi.string()).min(1).required(),
  pricePerNight: Joi.number().positive().precision(2).required(),
  taxes: Joi.number().min(0).precision(2).default(0),
  serviceFee: Joi.number().min(0).precision(2).default(0),
  totalCost: Joi.number().positive().precision(2).required(),
  guestName: Joi.string().required().max(255),
  guestEmail: Joi.string().email().required().max(255),
  guestPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  accommodationId: Joi.string().required()
});

const updateAccommodationBookingSchema = Joi.object({
  checkInDate: Joi.date().iso(),
  checkOutDate: Joi.date().iso().greater(Joi.ref('checkInDate')),
  totalGuests: Joi.number().integer().min(1).max(20),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum)
}).min(1);

// ==================== TRANSPORTATION BOOKING SCHEMAS ====================

const transportationBookingSchema = Joi.object({
  serviceType: Joi.string().valid(...transportationServiceTypeEnum).required(),
  pickupLocation: Joi.string().required().max(500),
  dropoffLocation: Joi.string().required().max(500),
  pickupTime: Joi.date().iso().required(),
  estimatedArrival: Joi.date().iso().greater(Joi.ref('pickupTime')),
  numberOfPassengers: Joi.number().integer().min(1).max(100).default(1),
  specialRequests: Joi.string().max(1000).allow(''),
  estimatedFare: Joi.number().positive().precision(2),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  providerId: Joi.string().required(),
  vehicleId: Joi.string(),
  vehicleType: Joi.string(),
  vehicleNumber: Joi.string(),
  driverName: Joi.string(),
  driverContact: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/)
});

const updateTransportationBookingSchema = Joi.object({
  pickupTime: Joi.date().iso(),
  estimatedArrival: Joi.date().iso(),
  specialRequests: Joi.string().max(1000).allow(''),
  estimatedFare: Joi.number().positive().precision(2),
  actualFare: Joi.number().positive().precision(2),
  actualPickupTime: Joi.date().iso(),
  actualDropoffTime: Joi.date().iso(),
  status: Joi.string().valid(...transportationStatusEnum),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  isPaid: Joi.boolean()
}).min(1);

// ==================== PACKAGE BOOKING SCHEMAS ====================

const packageBookingSchema = Joi.object({
  packageId: Joi.string().required(),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().greater(Joi.ref('startDate')).required(),
  numberOfTravelers: Joi.number().integer().min(1).max(100).default(1),
  leadGuestName: Joi.string().required().max(255),
  leadGuestEmail: Joi.string().email().required().max(255),
  leadGuestPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum)
});

const updatePackageBookingSchema = Joi.object({
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().greater(Joi.ref('startDate')),
  numberOfTravelers: Joi.number().integer().min(1).max(100),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  status: Joi.string().valid(...bookingStatusEnum)
}).min(1);

// ==================== EXPERIENCE BOOKING SCHEMAS ====================

const experienceBookingSchema = Joi.object({
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

const updateExperienceBookingSchema = Joi.object({
  experienceDate: Joi.date().iso(),
  numberOfParticipants: Joi.number().integer().min(1).max(100),
  numberOfChildren: Joi.number().integer().min(0).max(50),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  status: Joi.string().valid(...bookingStatusEnum)
}).min(1);

// ==================== SHOPPING VISIT SCHEMAS ====================

const shoppingVisitSchema = Joi.object({
  storeId: Joi.string().required(),
  plannedDate: Joi.date().iso().required(),
  duration: Joi.number().integer().min(15).max(480),
  purpose: Joi.string().max(500),
  plannedItems: Joi.array().items(Joi.object({
    productId: Joi.string(),
    name: Joi.string().max(255),
    quantity: Joi.number().integer().min(1).max(100),
    estimatedPrice: Joi.number().positive().precision(2)
  }))
});

const updateShoppingVisitSchema = Joi.object({
  plannedDate: Joi.date().iso(),
  actualVisitDate: Joi.date().iso(),
  duration: Joi.number().integer().min(15).max(480),
  purpose: Joi.string().max(500),
  plannedItems: Joi.array().items(Joi.object({
    productId: Joi.string(),
    name: Joi.string().max(255),
    quantity: Joi.number().integer().min(1).max(100),
    estimatedPrice: Joi.number().positive().precision(2)
  })),
  status: Joi.string().valid(...shoppingVisitStatusEnum)
}).min(1);

// ==================== CUSTOM TRAVEL EXPERIENCE SCHEMAS ====================

const travelExperienceSchema = Joi.object({
  title: Joi.string().required().max(255),
  description: Joi.string().max(1000).allow(''),
  date: Joi.date().iso().required(),
  startTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  endTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  location: Joi.string().max(500),
  cost: Joi.number().positive().precision(2).default(0),
  category: Joi.string().valid(...experienceCategoryEnum).default('SIGHTSEEING'),
  aiNotes: Joi.string().max(2000).allow('')
});

const updateTravelExperienceSchema = travelExperienceSchema.fork(
  ['title', 'date'],
  (field) => field.optional()
);

module.exports = {
  // Core schemas
  createTravelPlanSchema,
  updateTravelPlanSchema,
  sharePlanSchema,
  generateItinerarySchema,
  duplicatePlanSchema,
  updateBudgetSchema,
  exportQuerySchema,
  
  // Accommodation schemas
  accommodationBookingSchema,
  updateAccommodationBookingSchema,
  
  // Transportation schemas
  transportationBookingSchema,
  updateTransportationBookingSchema,
  
  // Package schemas
  packageBookingSchema,
  updatePackageBookingSchema,
  
  // Experience schemas
  experienceBookingSchema,
  updateExperienceBookingSchema,
  
  // Shopping schemas
  shoppingVisitSchema,
  updateShoppingVisitSchema,
  
  // Custom experience schemas
  travelExperienceSchema,
  updateTravelExperienceSchema
};