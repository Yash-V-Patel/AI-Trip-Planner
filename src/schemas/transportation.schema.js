const Joi = require('joi');

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

// Create provider schema
const createProviderSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  providerType: Joi.string().valid(...providerTypeEnum).required(),
  serviceArea: Joi.array().items(Joi.string()).min(1).required(),
  contactNumber: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  email: Joi.string().email().max(255),
  website: Joi.string().uri().max(255),
  baseFare: Joi.number().positive().precision(2),
  perKmRate: Joi.number().positive().precision(2),
  perMinuteRate: Joi.number().positive().precision(2),
  isAvailable: Joi.boolean().default(true),
  operatingHours: Joi.object(),
  vehicleTypes: Joi.array().items(Joi.string()).min(1),
  isVerified: Joi.boolean().default(false)
});

// Update provider schema
const updateProviderSchema = createProviderSchema.fork(
  ['name', 'providerType', 'serviceArea'],
  (field) => field.optional()
);

// Create vehicle schema
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

// Update vehicle schema
const updateVehicleSchema = createVehicleSchema.fork(
  ['vehicleNumber', 'vehicleType'],
  (field) => field.optional()
);

// Bulk vehicles schema
const bulkVehiclesSchema = Joi.object({
  vehicles: Joi.array().items(createVehicleSchema).min(1).max(100).required()
});

// Update location schema
const updateLocationSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required()
});

// Create booking schema
const createBookingSchema = Joi.object({
  serviceType: Joi.string().valid(...serviceTypeEnum).required(),
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

// Update booking schema
const updateBookingSchema = Joi.object({
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

// Fare calculation schema
const fareCalculationSchema = Joi.object({
  providerId: Joi.string().required(),
  distance: Joi.number().positive(),
  duration: Joi.number().positive(),
  vehicleType: Joi.string()
}).min(2);

// Available vehicles query schema
const availableVehiclesQuerySchema = Joi.object({
  pickupTime: Joi.date().iso().required(),
  dropoffTime: Joi.date().iso().greater(Joi.ref('pickupTime')).required(),
  passengers: Joi.number().integer().min(1).max(100).default(1),
  vehicleType: Joi.string()
});

// Vehicle history query schema
const vehicleHistoryQuerySchema = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  limit: Joi.number().integer().min(1).max(200).default(50)
});

module.exports = {
  createProviderSchema,
  updateProviderSchema,
  createVehicleSchema,
  updateVehicleSchema,
  bulkVehiclesSchema,
  updateLocationSchema,
  createBookingSchema,
  updateBookingSchema,
  fareCalculationSchema,
  availableVehiclesQuerySchema,
  vehicleHistoryQuerySchema
};