// Updated schemas file: schemas/store.schema.js
const Joi = require('joi');

// Enums (aligned with controller)
const storeTypeEnum = [
  'SHOPPING_MALL',
  'DEPARTMENT_STORE',
  'BOUTIQUE',
  'SOUVENIR_SHOP',
  'ELECTRONICS',
  'BOOKSTORE',
  'SUPERMARKET',
  'OTHER'
];

const priceRangeEnum = ['BUDGET', 'MODERATE', 'EXPENSIVE', 'LUXURY'];
const shoppingVisitStatusEnum = ['PLANNED', 'VISITED', 'SKIPPED', 'CANCELLED'];
const dayOfWeekEnum = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// ==================== Core Store Schemas ====================
const createStoreSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(2000).allow(''),
  storeType: Joi.string().valid(...storeTypeEnum).default('SHOPPING_MALL'),
  address: Joi.string().required().max(500),
  city: Joi.string().required().max(100),
  country: Joi.string().required().max(100),
  category: Joi.string().max(100),
  phone: Joi.string().pattern(/^[0-9+\-\s()]{10,20}$/),
  email: Joi.string().email().max(255),
  website: Joi.string().uri().max(255),
  openingHours: Joi.object({
    monday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    tuesday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    wednesday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    thursday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    friday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    saturday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    sunday: Joi.object({ open: Joi.string(), close: Joi.string() })
  }),
  priceRange: Joi.string().valid(...priceRangeEnum),
  images: Joi.array().items(Joi.string().uri()).max(20),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
  isActive: Joi.boolean().default(true)
});

const updateStoreSchema = createStoreSchema.fork(
  ['name', 'address', 'city', 'country'],
  (field) => field.optional()
);

const toggleStoreStatusSchema = Joi.object({
  isActive: Joi.boolean().required()
});

const storeHoursSchema = Joi.object({
  openingHours: Joi.object({
    monday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    tuesday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    wednesday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    thursday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    friday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    saturday: Joi.object({ open: Joi.string(), close: Joi.string() }),
    sunday: Joi.object({ open: Joi.string(), close: Joi.string() })
  }).required()
});

// ==================== Product Schemas ====================
const addProductSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(1000).allow(''),
  price: Joi.number().positive().precision(2).required(),
  currency: Joi.string().length(3).default('USD'),
  category: Joi.string().max(100),
  brand: Joi.string().max(100),
  sku: Joi.string().max(50),
  images: Joi.array().items(Joi.string().uri()),
  inStock: Joi.boolean().default(true),
  quantity: Joi.number().integer().min(0).default(0),
  specifications: Joi.object(),
  tags: Joi.array().items(Joi.string())
});

const bulkProductsSchema = Joi.object({
  products: Joi.array().items(addProductSchema).min(1).max(1000).required()
});

const updateProductSchema = addProductSchema.fork(
  ['name', 'price'],
  (field) => field.optional()
);

// ==================== Shopping Visit Schemas ====================
const createShoppingVisitSchema = Joi.object({
  storeId: Joi.string().required(),
  plannedDate: Joi.date().iso().required(),
  duration: Joi.number().integer().min(15).max(480),
  purpose: Joi.string().max(500),
  plannedItems: Joi.array().items(Joi.object({
    productId: Joi.string(),
    name: Joi.string(),
    quantity: Joi.number().integer().min(1),
    estimatedPrice: Joi.number().positive()
  })),
  aiNotes: Joi.string().max(2000).allow(''),
  recommendations: Joi.any()
});

const updateShoppingVisitSchema = Joi.object({
  plannedDate: Joi.date().iso(),
  actualVisitDate: Joi.date().iso(),
  duration: Joi.number().integer().min(15).max(480),
  purpose: Joi.string().max(500),
  plannedItems: Joi.array().items(Joi.object({
    productId: Joi.string(),
    name: Joi.string(),
    quantity: Joi.number().integer().min(1),
    estimatedPrice: Joi.number().positive()
  })),
  status: Joi.string().valid(...shoppingVisitStatusEnum),
  aiNotes: Joi.string().max(2000).allow(''),
  recommendations: Joi.any()
}).min(1);

// ==================== Review Schemas ====================
const storeReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(1000)
});

// ==================== Query Schemas ====================
const paginationQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const nearbyStoresQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(50).default(5),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

const storeProductsQuerySchema = Joi.object({
  category: Joi.string(),
  minPrice: Joi.number().positive(),
  maxPrice: Joi.number().positive(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const myStoresQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'inactive'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const shoppingVisitsQuerySchema = Joi.object({
  status: Joi.string().valid(...shoppingVisitStatusEnum),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

// ==================== Admin Schemas ====================
const adminStoresQuerySchema = Joi.object({
  vendorId: Joi.string(),
  isActive: Joi.boolean(),
  isVerified: Joi.boolean(),
  city: Joi.string(),
  country: Joi.string(),
  storeType: Joi.string().valid(...storeTypeEnum),
  search: Joi.string(),
  sortBy: Joi.string().valid('createdAt', 'name', 'rating', 'city'),
  sortOrder: Joi.string().valid('asc', 'desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminVerifyStoreSchema = Joi.object({
  isVerified: Joi.boolean().required()
});

const adminStoreVisitsQuerySchema = Joi.object({
  status: Joi.string().valid(...shoppingVisitStatusEnum),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const adminUpdateVisitStatusSchema = Joi.object({
  status: Joi.string().valid(...shoppingVisitStatusEnum).required(),
  notes: Joi.string().max(1000)
});

module.exports = {
  // Core
  createStoreSchema,
  updateStoreSchema,
  toggleStoreStatusSchema,
  storeHoursSchema,
  // Product
  addProductSchema,
  bulkProductsSchema,
  updateProductSchema,
  // Shopping visit
  createShoppingVisitSchema,
  updateShoppingVisitSchema,
  // Review
  storeReviewSchema,
  // Query
  paginationQuerySchema,
  nearbyStoresQuerySchema,
  storeProductsQuerySchema,
  myStoresQuerySchema,
  shoppingVisitsQuerySchema,
  // Admin
  adminStoresQuerySchema,
  adminVerifyStoreSchema,
  adminStoreVisitsQuerySchema,
  adminUpdateVisitStatusSchema
};