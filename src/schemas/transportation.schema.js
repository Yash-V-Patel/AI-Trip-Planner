// Updated schemas file: schemas/transportation.schema.js
const Joi = require('joi');

// Enums (as defined in original)
const providerTypeEnum = [
  'TAXI_SERVICE', 'RIDE_SHARING', 'CAR_RENTAL', 'BUS_COMPANY',
  'TRAIN_SERVICE', 'AIRLINE', 'FERRY_SERVICE', 'BICYCLE_RENTAL', 'OTHER'
];

const serviceTypeEnum = [
  'TAXI', 'BUS', 'TRAIN', 'FLIGHT', 'FERRY', 'CAR_RENTAL', 'BICYCLE', 'WALKING', 'OTHER'
];

const transportationStatusEnum = [
  'BOOKED', 'CONFIRMED', 'ON_THE_WAY', 'ARRIVED', 'CANCELLED', 'DELAYED', 'COMPLETED'
];

const paymentMethodEnum = ['CASH', 'CARD', 'DIGITAL_WALLET', 'ONLINE_PAYMENT', 'VOUCHER'];
const paymentStatusEnum = ['PENDING', 'PAID', 'REFUNDED', 'FAILED', 'PARTIALLY_PAID'];
const daysOfWeekEnum = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// ==================== Provider Schemas ====================
const createProviderSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  providerType: Joi.string().valid(...providerTypeEnum).required(),
  serviceArea: Joi.array().items(Joi.string()).min(1).required(),
  contactNumber: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  email: Joi.string().email().max(255),
  website: Joi.string().uri().max(255),
  rating: Joi.number().min(0).max(5),
  baseFare: Joi.number().positive().precision(2),
  perKmRate: Joi.number().positive().precision(2),
  perMinuteRate: Joi.number().positive().precision(2),
  isAvailable: Joi.boolean().default(true),
  operatingHours: Joi.object(),
  vehicleTypes: Joi.array().items(Joi.string()).min(1),
  isVerified: Joi.boolean().default(false)
});

const updateProviderSchema = createProviderSchema.fork(
  ['name', 'providerType', 'serviceArea'],
  (field) => field.optional()
);

const toggleProviderStatusSchema = Joi.object({
  isAvailable: Joi.boolean().required()
});

const providerStatsSchema = Joi.object({
  id: Joi.string().required()
}).unknown(true); // for path params

const providerBookingsQuerySchema = Joi.object({
  status: Joi.string().valid(...transportationStatusEnum).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// ==================== Vehicle Schemas ====================
const createVehicleSchema = Joi.object({
  vehicleNumber: Joi.string().required().max(50),
  vehicleType: Joi.string().required().max(50),
  make: Joi.string().max(50),
  model: Joi.string().max(50),
  year: Joi.number().integer().min(1900).max(new Date().getFullYear() + 1),
  color: Joi.string().max(30),
  capacity: Joi.number().integer().min(1).max(100).default(4),
  amenities: Joi.array().items(Joi.string()).max(30),
  driverName: Joi.string().max(100),
  driverContact: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  driverRating: Joi.number().min(0).max(5).default(0),
  isAvailable: Joi.boolean().default(true),
  currentLocation: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required()
  })
});

const updateVehicleSchema = createVehicleSchema.fork(
  ['vehicleNumber', 'vehicleType'],
  (field) => field.optional()
);

const bulkVehiclesSchema = Joi.object({
  vehicles: Joi.array().items(createVehicleSchema).min(1).max(100).required()
});

const updateLocationSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required()
});

const bulkUpdateVehicleAvailabilitySchema = Joi.object({
  vehicleIds: Joi.array().items(Joi.string()).min(1).required(),
  isAvailable: Joi.boolean().required()
});

const vehicleHistoryQuerySchema = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  limit: Joi.number().integer().min(1).max(200).default(50)
});

// ==================== Booking Schemas ====================
const createBookingSchema = Joi.object({
  providerId: Joi.string().required(),
  vehicleId: Joi.string().optional(),
  serviceType: Joi.string().valid(...serviceTypeEnum).required(),
  pickupLocation: Joi.string().required().max(500),
  dropoffLocation: Joi.string().required().max(500),
  pickupTime: Joi.date().iso().required(),
  estimatedArrival: Joi.date().iso().greater(Joi.ref('pickupTime')).optional(),
  numberOfPassengers: Joi.number().integer().min(1).max(100).default(1),
  specialRequests: Joi.string().max(1000).allow(''),
  estimatedFare: Joi.number().positive().precision(2).optional(),
  paymentMethod: Joi.string().valid(...paymentMethodEnum).optional()
  // Snapshot fields are not expected from client; they are stamped from vehicle record.
});

const updateBookingSchema = Joi.object({
  pickupLocation: Joi.string().max(500),
  dropoffLocation: Joi.string().max(500),
  pickupTime: Joi.date().iso(),
  estimatedArrival: Joi.date().iso(),
  numberOfPassengers: Joi.number().integer().min(1).max(100),
  specialRequests: Joi.string().max(1000).allow(''),
  status: Joi.string().valid(...transportationStatusEnum),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  actualFare: Joi.number().positive().precision(2),
  actualPickupTime: Joi.date().iso(),
  actualDropoffTime: Joi.date().iso()
}).min(1);

// Fare calculation schema
const fareCalculationSchema = Joi.object({
  providerId: Joi.string().required(),
  distance: Joi.number().positive().optional(),
  duration: Joi.number().positive().optional(),
  vehicleType: Joi.string().optional()
}).min(2); // at least providerId + one other field

// Available vehicles query schema
const availableVehiclesQuerySchema = Joi.object({
  pickupTime: Joi.date().iso().required(),
  dropoffTime: Joi.date().iso().greater(Joi.ref('pickupTime')).required(),
  passengers: Joi.number().integer().min(1).max(100).default(1),
  vehicleType: Joi.string().optional()
});

// ==================== Admin Schemas ====================
const adminProvidersQuerySchema = Joi.object({
  vendorId: Joi.string(),
  isAvailable: Joi.boolean(),
  isVerified: Joi.boolean(),
  isFeatured: Joi.boolean(),
  providerType: Joi.string().valid(...providerTypeEnum),
  search: Joi.string(),
  sortBy: Joi.string().valid('createdAt', 'name', 'rating', 'baseFare'),
  sortOrder: Joi.string().valid('asc', 'desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminVerifyProviderSchema = Joi.object({
  isVerified: Joi.boolean().required()
});

const adminFeatureProviderSchema = Joi.object({
  isFeatured: Joi.boolean().required(),
  featuredUntil: Joi.date().iso().optional()
});

const adminBookingsQuerySchema = Joi.object({
  status: Joi.string().valid(...transportationStatusEnum),
  providerId: Joi.string(),
  vehicleId: Joi.string(),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminUpdateBookingStatusSchema = Joi.object({
  status: Joi.string().valid(...transportationStatusEnum).required(),
  notes: Joi.string().max(1000)
});

module.exports = {
  // Provider
  createProviderSchema,
  updateProviderSchema,
  toggleProviderStatusSchema,
  providerStatsSchema,
  providerBookingsQuerySchema,
  
  // Vehicle
  createVehicleSchema,
  updateVehicleSchema,
  bulkVehiclesSchema,
  updateLocationSchema,
  bulkUpdateVehicleAvailabilitySchema,
  vehicleHistoryQuerySchema,
  
  // Booking
  createBookingSchema,
  updateBookingSchema,
  fareCalculationSchema,
  availableVehiclesQuerySchema,
  
  // Admin
  adminProvidersQuerySchema,
  adminVerifyProviderSchema,
  adminFeatureProviderSchema,
  adminBookingsQuerySchema,
  adminUpdateBookingStatusSchema
};