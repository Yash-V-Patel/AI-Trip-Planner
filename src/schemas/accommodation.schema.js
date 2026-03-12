// Updated schemas file: schemas/accommodation.schema.js
const Joi = require('joi');

// Enums (as defined in original)
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
const daysOfWeekEnum = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// ==================== Core Accommodation Schemas ====================
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

const updateAccommodationSchema = createAccommodationSchema.fork(
  ['name', 'address', 'city', 'country'],
  (field) => field.optional()
);

const toggleAccommodationStatusSchema = Joi.object({
  isActive: Joi.boolean().required()
});

// ==================== Room Schemas ====================
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

const updateRoomSchema = createRoomSchema.fork(
  ['roomNumber', 'roomType', 'basePrice'],
  (field) => field.optional()
);

const bulkUpdateRoomAvailabilitySchema = Joi.object({
  roomIds: Joi.array().items(Joi.string()).min(1).required(),
  isAvailable: Joi.boolean().required()
});

// ==================== Service Schemas ====================
const createServiceSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(500).allow(''),
  category: Joi.string().valid(...serviceCategoryEnum).required(),
  price: Joi.number().positive().precision(2),
  isIncluded: Joi.boolean().default(false),
  isAvailable: Joi.boolean().default(true),
  availableStartTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  availableEndTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/),
  daysAvailable: Joi.array().items(Joi.string().valid(...daysOfWeekEnum)),
  locationInAccommodation: Joi.string().max(255)
});

const updateServiceSchema = createServiceSchema.fork(
  ['name', 'category'],
  (field) => field.optional()
);

// ==================== Booking Schemas ====================
const createBookingSchema = Joi.object({
  accommodationId: Joi.string().required(),
  roomIds: Joi.array().items(Joi.string()).min(1).required(),
  checkInDate: Joi.date().iso().required(),
  checkOutDate: Joi.date().iso().greater(Joi.ref('checkInDate')).required(),
  totalGuests: Joi.number().integer().min(1).max(20).default(1),
  roomType: Joi.string().valid(...roomTypeEnum).required(),
  pricePerNight: Joi.number().positive().precision(2).required(),
  taxes: Joi.number().min(0).precision(2).default(0),
  serviceFee: Joi.number().min(0).precision(2).default(0),
  totalCost: Joi.number().positive().precision(2).required(),
  guestName: Joi.string().required().max(255),
  guestEmail: Joi.string().email().required().max(255),
  guestPhone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  transactionId: Joi.string().max(255)
});

const updateBookingSchema = Joi.object({
  checkInDate: Joi.date().iso(),
  checkOutDate: Joi.date().iso().greater(Joi.ref('checkInDate')),
  totalGuests: Joi.number().integer().min(1).max(20),
  specialRequests: Joi.string().max(1000).allow(''),
  paymentStatus: Joi.string().valid(...paymentStatusEnum),
  paymentMethod: Joi.string().valid(...paymentMethodEnum),
  bookingStatus: Joi.string().valid(...bookingStatusEnum)
}).min(1);

// ==================== Query Schemas ====================
const availableRoomsQuerySchema = Joi.object({
  checkIn: Joi.date().iso().required(),
  checkOut: Joi.date().iso().greater(Joi.ref('checkIn')).required(),
  guests: Joi.number().integer().min(1).max(20).default(1)
});

const vendorAccommodationsQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'inactive'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const vendorBookingsQuerySchema = Joi.object({
  status: Joi.string().valid(...bookingStatusEnum),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// ==================== Admin Schemas ====================
const adminAccommodationsQuerySchema = Joi.object({
  vendorId: Joi.string(),
  isActive: Joi.boolean(),
  isVerified: Joi.boolean(),
  isFeatured: Joi.boolean(),
  city: Joi.string(),
  country: Joi.string(),
  search: Joi.string(),
  sortBy: Joi.string().valid('createdAt', 'name', 'starRating', 'overallRating', 'city'),
  sortOrder: Joi.string().valid('asc', 'desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminVerifyAccommodationSchema = Joi.object({
  isVerified: Joi.boolean().required()
});

const adminFeatureAccommodationSchema = Joi.object({
  isFeatured: Joi.boolean().required(),
  featuredUntil: Joi.date().iso().optional()
});

const adminBookingsQuerySchema = Joi.object({
  status: Joi.string().valid(...bookingStatusEnum),
  accommodationId: Joi.string(),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminUpdateBookingStatusSchema = Joi.object({
  bookingStatus: Joi.string().valid(...bookingStatusEnum).required(),
  notes: Joi.string().max(1000)
});

module.exports = {
  // Core
  createAccommodationSchema,
  updateAccommodationSchema,
  toggleAccommodationStatusSchema,
  // Room
  createRoomSchema,
  updateRoomSchema,
  bulkUpdateRoomAvailabilitySchema,
  // Service
  createServiceSchema,
  updateServiceSchema,
  // Booking
  createBookingSchema,
  updateBookingSchema,
  availableRoomsQuerySchema,
  // Vendor
  vendorAccommodationsQuerySchema,
  vendorBookingsQuerySchema,
  // Admin
  adminAccommodationsQuerySchema,
  adminVerifyAccommodationSchema,
  adminFeatureAccommodationSchema,
  adminBookingsQuerySchema,
  adminUpdateBookingStatusSchema
};