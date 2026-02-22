const Joi = require('joi');

const accommodationTypeEnum = [
  'HOTEL', 'RESORT', 'MOTEL', 'HOSTEL',
  'BED_BREAKFAST', 'VACATION_RENTAL', 'APARTMENT', 'GUEST_HOUSE'
];

const priceCategoryEnum = ['BUDGET', 'MIDRANGE', 'LUXURY', 'BOUTIQUE'];
const roomTypeEnum = ['SINGLE', 'DOUBLE', 'TWIN', 'TRIPLE', 'SUITE', 'DELUXE', 'FAMILY', 'PRESIDENTIAL'];
const serviceCategoryEnum = ['DINING', 'WELLNESS', 'ENTERTAINMENT', 'BUSINESS', 'TRANSPORTATION', 'HOUSEKEEPING', 'CONCIERGE', 'OTHER'];
const bookingStatusEnum = ['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'NO_SHOW'];
const paymentStatusEnum = ['PENDING', 'PAID', 'REFUNDED', 'FAILED', 'PARTIALLY_PAID'];
const paymentMethodEnum = ['CASH', 'CARD', 'DIGITAL_WALLET', 'ONLINE_PAYMENT', 'VOUCHER'];

// Create accommodation schema
const createAccommodationSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  address: Joi.string().required().max(500),
  city: Joi.string().required().max(100),
  country: Joi.string().required().max(100),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
  phone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  email: Joi.string().email().max(255),
  website: Joi.string().uri().max(255),
  starRating: Joi.number().integer().min(1).max(5).default(3),
  overallRating: Joi.number().min(0).max(5).default(0),
  accommodationType: Joi.string().valid(...accommodationTypeEnum).default('HOTEL'),
  priceCategory: Joi.string().valid(...priceCategoryEnum).default('MIDRANGE'),
  amenities: Joi.array().items(Joi.string()).max(50),
  images: Joi.array().items(Joi.string().uri()).max(20),
  checkInTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  checkOutTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  policies: Joi.object(),
  isActive: Joi.boolean().default(true),
  isVerified: Joi.boolean().default(false)
});

// Update accommodation schema
const updateAccommodationSchema = createAccommodationSchema.fork(
  ['name', 'address', 'city', 'country'],
  (field) => field.optional()
);

// Create room schema
const createRoomSchema = Joi.object({
  roomNumber: Joi.string().required().max(50),
  roomType: Joi.string().valid(...roomTypeEnum).required(),
  description: Joi.string().max(500).allow(''),
  beds: Joi.number().integer().min(1).max(10).default(1),
  maxOccupancy: Joi.number().integer().min(1).max(20).default(2),
  hasView: Joi.boolean().default(false),
  hasBalcony: Joi.boolean().default(false),
  floor: Joi.number().integer().min(0).max(100),
  roomAmenities: Joi.array().items(Joi.string()).max(30),
  basePrice: Joi.number().positive().precision(2).required(),
  isAvailable: Joi.boolean().default(true)
});

// Update room schema
const updateRoomSchema = createRoomSchema.fork(
  ['roomNumber', 'roomType', 'basePrice'],
  (field) => field.optional()
);

// Create service schema
const createServiceSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(500).allow(''),
  category: Joi.string().valid(...serviceCategoryEnum).required(),
  price: Joi.number().positive().precision(2),
  isIncluded: Joi.boolean().default(false),
  isAvailable: Joi.boolean().default(true),
  availableStartTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  availableEndTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  daysAvailable: Joi.array().items(
    Joi.string().valid('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY')
  ),
  locationInAccommodation: Joi.string().max(255)
});

// Update service schema
const updateServiceSchema = createServiceSchema.fork(
  ['name', 'category'],
  (field) => field.optional()
);

// Create booking schema
const createBookingSchema = Joi.object({
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

// Update booking schema
const updateBookingSchema = Joi.object({
  checkInDate: Joi.date().iso(),
  checkOutDate: Joi.date().iso().greater(Joi.ref('checkInDate')),
  totalGuests: Joi.number().integer().min(1).max(20),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentMethod: Joi.string().valid(...paymentMethodEnum)
}).min(1);

// Available rooms query schema
const availableRoomsQuerySchema = Joi.object({
  checkIn: Joi.date().iso().required(),
  checkOut: Joi.date().iso().greater(Joi.ref('checkIn')).required(),
  guests: Joi.number().integer().min(1).max(20).default(1)
});

module.exports = {
  createAccommodationSchema,
  updateAccommodationSchema,
  createRoomSchema,
  updateRoomSchema,
  createServiceSchema,
  updateServiceSchema,
  createBookingSchema,
  updateBookingSchema,
  availableRoomsQuerySchema
};