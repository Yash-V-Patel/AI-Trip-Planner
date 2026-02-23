const Joi = require('joi');

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

// Create store schema
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

// Update store schema
const updateStoreSchema = createStoreSchema.fork(
  ['name', 'address', 'city', 'country'],
  (field) => field.optional()
);

// Store hours schema
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

// Add product schema
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

// Bulk products schema
const bulkProductsSchema = Joi.object({
  products: Joi.array().items(addProductSchema).min(1).max(1000).required()
});

// Update product schema
const updateProductSchema = addProductSchema.fork(
  ['name', 'price'],
  (field) => field.optional()
);

// Create shopping visit schema
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
  }))
});

// Update shopping visit schema
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
  status: Joi.string().valid(...shoppingVisitStatusEnum)
}).min(1);

// Store review schema
const storeReviewSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().max(1000)
});

// Nearby stores query schema
const nearbyStoresQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(50).default(5),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

module.exports = {
  createStoreSchema,
  updateStoreSchema,
  storeHoursSchema,
  addProductSchema,
  bulkProductsSchema,
  updateProductSchema,
  createShoppingVisitSchema,
  updateShoppingVisitSchema,
  storeReviewSchema,
  nearbyStoresQuerySchema
};