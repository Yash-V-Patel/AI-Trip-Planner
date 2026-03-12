/**
 * @swagger
 * tags:
 *   - name: Stores
 *     description: Public store listing and discovery
 *   - name: Store Management
 *     description: Vendor operations for managing their stores
 *   - name: Store Products
 *     description: Product management within stores
 *   - name: Shopping Visits
 *     description: Travel plan related shopping visits
 *   - name: Store Reviews
 *     description: Store ratings and reviews
 *   - name: Admin Stores
 *     description: SuperAdmin store administration
 */

const express = require('express');
const router = express.Router();
const storeController = require('../controllers/store.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createStoreSchema,
  updateStoreSchema,
  toggleStoreStatusSchema,
  storeHoursSchema,
  addProductSchema,
  bulkProductsSchema,
  updateProductSchema,
  createShoppingVisitSchema,
  updateShoppingVisitSchema,
  storeReviewSchema,
  nearbyStoresQuerySchema,
  storeProductsQuerySchema,
  myStoresQuerySchema,
  shoppingVisitsQuerySchema,
  paginationQuerySchema,
  adminStoresQuerySchema,
  adminVerifyStoreSchema,
  adminStoreVisitsQuerySchema,
  adminUpdateVisitStatusSchema
} = require('../schemas/store.schema');

// ==================== PUBLIC ROUTES ====================

/**
 * @swagger
 * /stores:
 *   get:
 *     summary: Get all stores with optional filters
 *     tags: [Stores]
 *     parameters:
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         description: Filter by city
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *         description: Filter by country
 *       - in: query
 *         name: storeType
 *         schema: { type: string, enum: [SHOPPING_MALL, DEPARTMENT_STORE, BOUTIQUE, SOUVENIR_SHOP, ELECTRONICS, BOOKSTORE, SUPERMARKET, OTHER] }
 *         description: Type of store
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Store category
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Keyword search on name/description
 *       - in: query
 *         name: minRating
 *         schema: { type: number, minimum: 0, maximum: 5 }
 *         description: Minimum rating
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *         description: Maximum price (maps to priceRange)
 *       - in: query
 *         name: lat
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude for geo proximity
 *       - in: query
 *         name: lng
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude for geo proximity
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 5 }
 *         description: Radius in km for geo proximity
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, name, rating, city], default: rating }
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *         description: Sort order
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Store' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 filters: { type: object }
 *       400:
 *         description: Invalid parameters
 */
router.get('/', storeController.getAllStores);

/**
 * @swagger
 * /stores/nearby:
 *   get:
 *     summary: Find stores near a geographic point
 *     tags: [Stores]
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number, minimum: -90, maximum: 90 }
 *         description: Latitude
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number, minimum: -180, maximum: 180 }
 *         description: Longitude
 *       - in: query
 *         name: radius
 *         schema: { type: number, default: 5, maximum: 50 }
 *         description: Search radius in km
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *         description: Max number of results
 *     responses:
 *       200:
 *         description: List of nearby stores with distance
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - { $ref: '#/components/schemas/Store' }
 *                       - properties:
 *                           distanceKm: { type: number, example: 2.45 }
 *                 count: { type: integer }
 *       400:
 *         description: Missing lat/lng
 */
router.get(
  '/nearby',
  validate(nearbyStoresQuerySchema, 'query'),
  storeController.getNearbyStores
);

/**
 * @swagger
 * /stores/city/{city}:
 *   get:
 *     summary: Get stores by city name
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: city
 *         required: true
 *         schema: { type: string }
 *         description: City name
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of stores in the city
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Store' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/city/:city', storeController.getStoresByCity);

/**
 * @swagger
 * /stores/{id}:
 *   get:
 *     summary: Get store details by ID
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Store UUID
 *     responses:
 *       200:
 *         description: Store details (includes vendor info and upcoming visits)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/StoreDetail' }
 *                 cached: { type: boolean }
 *       404:
 *         description: Store not found or inactive
 */
router.get('/:id', storeController.getStoreById);

/**
 * @swagger
 * /stores/{storeId}/products:
 *   get:
 *     summary: Get products of a store (public)
 *     tags: [Stores]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by product category
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *         description: Minimum price
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *         description: Maximum price
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated list of products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Product' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       404:
 *         description: Store not found
 */
router.get(
  '/:storeId/products',
  validate(storeProductsQuerySchema, 'query'),
  storeController.getStoreProducts
);

// ==================== PROTECTED ROUTES ====================
router.use(authMiddleware.authenticate);

// -------------------- Store Management --------------------

/**
 * @swagger
 * /stores:
 *   post:
 *     summary: Create a new store (vendor only)
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, address, city, country]
 *             properties:
 *               name: { type: string, maxLength: 255, example: "City Mall" }
 *               description: { type: string, maxLength: 2000 }
 *               storeType: { type: string, enum: [SHOPPING_MALL, DEPARTMENT_STORE, BOUTIQUE, SOUVENIR_SHOP, ELECTRONICS, BOOKSTORE, SUPERMARKET, OTHER], default: SHOPPING_MALL }
 *               address: { type: string, maxLength: 500 }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               category: { type: string, maxLength: 100 }
 *               phone: { type: string, pattern: "^[0-9+\\-\\s()]{10,20}$" }
 *               email: { type: string, format: email }
 *               website: { type: string, format: uri }
 *               openingHours: { type: object, example: { monday: { open: "09:00", close: "21:00" } } }
 *               priceRange: { type: string, enum: [BUDGET, MODERATE, EXPENSIVE, LUXURY] }
 *               images: { type: array, items: { type: string, format: uri } }
 *               latitude: { type: number, minimum: -90, maximum: 90 }
 *               longitude: { type: number, minimum: -180, maximum: 180 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Store created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Store' }
 *                 message: { type: string }
 *       403:
 *         description: Not authorized (vendor not approved)
 *       409:
 *         description: Name conflict (if unique)
 */
router.post(
  '/',
  validate(createStoreSchema),
  storeController.createStore
);

/**
 * @swagger
 * /stores/my-stores:
 *   get:
 *     summary: Get stores owned by the authenticated vendor
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *         description: Filter by active status
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of vendor's stores
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Store' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       404:
 *         description: Vendor profile not found
 */
router.get(
  '/my-stores',
  validate(myStoresQuerySchema, 'query'),
  storeController.getMyStores
);

/**
 * @swagger
 * /stores/{id}:
 *   put:
 *     summary: Update store details (owner/manager)
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 2000 }
 *               storeType: { type: string, enum: [SHOPPING_MALL, ...] }
 *               address: { type: string, maxLength: 500 }
 *               city: { type: string, maxLength: 100 }
 *               country: { type: string, maxLength: 100 }
 *               category: { type: string, maxLength: 100 }
 *               phone: { type: string, pattern: "^[0-9+\\-\\s()]{10,20}$" }
 *               email: { type: string, format: email }
 *               website: { type: string, format: uri }
 *               openingHours: { type: object }
 *               priceRange: { type: string, enum: [BUDGET, MODERATE, EXPENSIVE, LUXURY] }
 *               images: { type: array, items: { type: string, format: uri } }
 *               latitude: { type: number, min: -90, max: 90 }
 *               longitude: { type: number, min: -180, max: 180 }
 *               isActive: { type: boolean }  # only for superadmin
 *     responses:
 *       200:
 *         description: Store updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Store' }
 *                 message: { type: string }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.put(
  '/:id',
  validate(updateStoreSchema),
  storeController.updateStore
);

/**
 * @swagger
 * /stores/{id}:
 *   delete:
 *     summary: Delete a store (owner only)
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Store deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *       400:
 *         description: Cannot delete with upcoming visits
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.delete('/:id', storeController.deleteStore);

/**
 * @swagger
 * /stores/{id}/status:
 *   patch:
 *     summary: Activate or deactivate a store
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Status updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.patch(
  '/:id/status',
  validate(toggleStoreStatusSchema),
  storeController.toggleStoreStatus
);

/**
 * @swagger
 * /stores/{id}/hours:
 *   patch:
 *     summary: Update store opening hours
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [openingHours]
 *             properties:
 *               openingHours:
 *                 type: object
 *                 properties:
 *                   monday: { type: object, properties: { open: { type: string }, close: { type: string } } }
 *                   tuesday: { type: object, ... }
 *                   wednesday: { type: object, ... }
 *                   thursday: { type: object, ... }
 *                   friday: { type: object, ... }
 *                   saturday: { type: object, ... }
 *                   sunday: { type: object, ... }
 *     responses:
 *       200:
 *         description: Hours updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.patch(
  '/:id/hours',
  validate(storeHoursSchema),
  storeController.updateStoreHours
);

/**
 * @swagger
 * /stores/{storeId}/analytics:
 *   get:
 *     summary: Get store analytics (visits, ratings, trends)
 *     tags: [Store Management]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     store: { type: object }
 *                     stats: { type: object }
 *                     trends: { type: array }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.get('/:storeId/analytics', storeController.getStoreAnalytics);

// -------------------- Product Management --------------------

/**
 * @swagger
 * /stores/{storeId}/products:
 *   post:
 *     summary: Add a product to a store
 *     tags: [Store Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price]
 *             properties:
 *               name: { type: string, maxLength: 255 }
 *               description: { type: string, maxLength: 1000 }
 *               price: { type: number, positive: true, example: 29.99 }
 *               currency: { type: string, length: 3, default: "USD" }
 *               category: { type: string, maxLength: 100 }
 *               brand: { type: string, maxLength: 100 }
 *               sku: { type: string, maxLength: 50 }
 *               images: { type: array, items: { type: string, format: uri } }
 *               inStock: { type: boolean, default: true }
 *               quantity: { type: integer, min: 0, default: 0 }
 *               specifications: { type: object }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Product added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Product' }
 *                 message: { type: string }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.post(
  '/:storeId/products',
  validate(addProductSchema),
  storeController.addProduct
);

/**
 * @swagger
 * /stores/{storeId}/products/bulk:
 *   post:
 *     summary: Bulk import products
 *     tags: [Store Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [products]
 *             properties:
 *               products:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 1000
 *                 items:
 *                   $ref: '#/components/schemas/ProductInput'
 *     responses:
 *       201:
 *         description: Products imported
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Product' } }
 *                 message: { type: string }
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.post(
  '/:storeId/products/bulk',
  validate(bulkProductsSchema),
  storeController.bulkImportProducts
);

/**
 * @swagger
 * /stores/{storeId}/products/{productId}:
 *   put:
 *     summary: Update a product
 *     tags: [Store Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProductInput'
 *     responses:
 *       200:
 *         description: Product updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store or product not found
 */
router.put(
  '/:storeId/products/:productId',
  validate(updateProductSchema),
  storeController.updateProduct
);

/**
 * @swagger
 * /stores/{storeId}/products/{productId}:
 *   delete:
 *     summary: Delete a product
 *     tags: [Store Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Product deleted
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store or product not found
 */
router.delete(
  '/:storeId/products/:productId',
  storeController.deleteProduct
);

// -------------------- Shopping Visits --------------------

/**
 * @swagger
 * /stores/travel-plans/{travelPlanId}/shopping-visits:
 *   post:
 *     summary: Create a shopping visit for a travel plan
 *     tags: [Shopping Visits]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: travelPlanId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [storeId, plannedDate]
 *             properties:
 *               storeId: { type: string }
 *               plannedDate: { type: string, format: date }
 *               duration: { type: integer, min: 15, max: 480 }
 *               purpose: { type: string, maxLength: 500 }
 *               plannedItems:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string }
 *                     name: { type: string }
 *                     quantity: { type: integer, min: 1 }
 *                     estimatedPrice: { type: number }
 *               aiNotes: { type: string }
 *               recommendations: { type: object }
 *     responses:
 *       201:
 *         description: Shopping visit created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/ShoppingVisit' }
 *                 message: { type: string }
 *       403:
 *         description: No edit permission on travel plan
 *       404:
 *         description: Store or travel plan not found
 */
router.post(
  '/travel-plans/:travelPlanId/shopping-visits',
  validate(createShoppingVisitSchema),
  storeController.createShoppingVisit
);

/**
 * @swagger
 * /stores/travel-plans/{travelPlanId}/shopping-visits:
 *   get:
 *     summary: Get shopping visits for a travel plan
 *     tags: [Shopping Visits]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: travelPlanId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PLANNED, VISITED, SKIPPED, CANCELLED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of visits
 *       403:
 *         description: No view permission
 */
router.get(
  '/travel-plans/:travelPlanId/shopping-visits',
  validate(shoppingVisitsQuerySchema, 'query'),
  storeController.getShoppingVisits
);

/**
 * @swagger
 * /stores/shopping-visits/{visitId}:
 *   put:
 *     summary: Update a shopping visit
 *     tags: [Shopping Visits]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               plannedDate: { type: string, format: date }
 *               actualVisitDate: { type: string, format: date }
 *               duration: { type: integer }
 *               purpose: { type: string }
 *               plannedItems: { type: array, items: { type: object } }
 *               status: { type: string, enum: [PLANNED, VISITED, SKIPPED, CANCELLED] }
 *               aiNotes: { type: string }
 *               recommendations: { type: object }
 *     responses:
 *       200:
 *         description: Visit updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Visit not found
 */
router.put(
  '/shopping-visits/:visitId',
  validate(updateShoppingVisitSchema),
  storeController.updateShoppingVisit
);

/**
 * @swagger
 * /stores/shopping-visits/{visitId}:
 *   delete:
 *     summary: Cancel a shopping visit
 *     tags: [Shopping Visits]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Visit cancelled
 *       400:
 *         description: Cannot cancel visited or already cancelled
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Visit not found
 */
router.delete(
  '/shopping-visits/:visitId',
  storeController.cancelShoppingVisit
);

// -------------------- Store Reviews --------------------

/**
 * @swagger
 * /stores/{storeId}/reviews:
 *   post:
 *     summary: Add a review to a store
 *     tags: [Store Reviews]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, min: 1, max: 5, example: 4 }
 *               comment: { type: string, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Review submitted (aggregated rating updated)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     newRating: { type: number }
 *                     basedOnVisits: { type: integer }
 *       404:
 *         description: Store not found
 */
router.post(
  '/:storeId/reviews',
  validate(storeReviewSchema),
  storeController.addStoreReview
);

/**
 * @swagger
 * /stores/{storeId}/reviews:
 *   get:
 *     summary: Get reviews (proxied via completed visits) for a store
 *     tags: [Store Reviews]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Review summary and recent visits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     averageRating: { type: number }
 *                     totalCompleted: { type: integer }
 *                     statusBreakdown: { type: object }
 *                     recentVisits: { type: array }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       404:
 *         description: Store not found
 */
router.get(
  '/:storeId/reviews',
  validate(paginationQuerySchema, 'query'),
  storeController.getStoreReviews
);

// ==================== ADMIN ROUTES ====================

/**
 * @swagger
 * /stores/admin/stores:
 *   get:
 *     summary: Get all stores (superadmin view)
 *     tags: [Admin Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: vendorId
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: isVerified
 *         schema: { type: boolean }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: country
 *         schema: { type: string }
 *       - in: query
 *         name: storeType
 *         schema: { type: string, enum: [SHOPPING_MALL, ...] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, name, rating, city] }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of all stores with vendor info and visit counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminStore' } }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get(
  '/admin/stores',
  validate(adminStoresQuerySchema, 'query'),
  storeController.adminGetAllStores
);

/**
 * @swagger
 * /stores/admin/stores/{id}/verify:
 *   patch:
 *     summary: Verify or unverify a store
 *     tags: [Admin Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isVerified]
 *             properties:
 *               isVerified: { type: boolean }
 *     responses:
 *       200:
 *         description: Verification status updated
 *       403:
 *         description: Not authorized (superadmin only)
 *       404:
 *         description: Store not found
 */
router.patch(
  '/admin/stores/:id/verify',
  validate(adminVerifyStoreSchema),
  storeController.verifyStore
);

/**
 * @swagger
 * /stores/admin/stores/{storeId}/visits:
 *   get:
 *     summary: Get all visits for a specific store (admin)
 *     tags: [Admin Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PLANNED, VISITED, SKIPPED, CANCELLED] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: List of visits
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Store not found
 */
router.get(
  '/admin/stores/:storeId/visits',
  validate(adminStoreVisitsQuerySchema, 'query'),
  storeController.adminGetStoreVisits
);

/**
 * @swagger
 * /stores/admin/shopping-visits/{visitId}/status:
 *   patch:
 *     summary: Force update any visit status (admin)
 *     tags: [Admin Stores]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: visitId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [PLANNED, VISITED, SKIPPED, CANCELLED] }
 *               notes: { type: string, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Status updated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Visit not found
 */
router.patch(
  '/admin/shopping-visits/:visitId/status',
  validate(adminUpdateVisitStatusSchema),
  storeController.adminUpdateVisitStatus
);

module.exports = router;