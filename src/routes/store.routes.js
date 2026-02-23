const express = require('express');
const router = express.Router();
const storeController = require('../controllers/store.controller');
const authMiddleware = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createStoreSchema,
  updateStoreSchema,
  addProductSchema,
  bulkProductsSchema,
  updateProductSchema,
  createShoppingVisitSchema,
  updateShoppingVisitSchema,
  storeHoursSchema,
  storeReviewSchema,
  nearbyStoresQuerySchema
} = require('../schemas/store.schema');

// ==================== PUBLIC ROUTES ====================

// Get all stores (public)
router.get('/', storeController.getAllStores);

// Get nearby stores (public)
router.get(
  '/nearby',
  validate(nearbyStoresQuerySchema, 'query'),
  storeController.getNearbyStores
);

// Get stores by city (public)
router.get('/city/:city', storeController.getStoresByCity);

// Get store by ID (public)
router.get('/:id', storeController.getStoreById);

// Get store products (public)
router.get('/:storeId/products', storeController.getStoreProducts);

// ==================== PROTECTED ROUTES ====================

// All routes below require authentication
router.use(authMiddleware.authenticate);

// ==================== STORE MANAGEMENT ====================

// Create store (vendors with shopping permission)
router.post(
  '/',
  validate(createStoreSchema),
  storeController.createStore
);

// Get vendor's own stores
router.get('/my-stores', storeController.getMyStores);

// Update store (owner/manager)
router.put(
  '/:id',
  validate(updateStoreSchema),
  storeController.updateStore
);

// Delete store (owner only)
router.delete('/:id', storeController.deleteStore);

// Toggle store status
router.patch('/:id/toggle-status', storeController.toggleStoreStatus);

// Update store hours
router.patch(
  '/:id/hours',
  validate(storeHoursSchema),
  storeController.updateStoreHours
);

// Get store analytics (vendor only)
router.get('/:storeId/analytics', storeController.getStoreAnalytics);

// ==================== PRODUCT MANAGEMENT ====================

// Add product
router.post(
  '/:storeId/products',
  validate(addProductSchema),
  storeController.addProduct
);

// Bulk import products
router.post(
  '/:storeId/products/bulk',
  validate(bulkProductsSchema),
  storeController.bulkImportProducts
);

// Update product
router.put(
  '/:storeId/products/:productId',
  validate(updateProductSchema),
  storeController.updateProduct
);

// Delete product
router.delete(
  '/:storeId/products/:productId',
  storeController.deleteProduct
);

// ==================== SHOPPING VISITS ====================

// Create shopping visit (linked to travel plan)
router.post(
  '/travel-plans/:travelPlanId/shopping-visits',
  validate(createShoppingVisitSchema),
  storeController.createShoppingVisit
);

// Get shopping visits for a travel plan
router.get(
  '/travel-plans/:travelPlanId/shopping-visits',
  storeController.getShoppingVisits
);

// Update shopping visit
router.put(
  '/shopping-visits/:visitId',
  validate(updateShoppingVisitSchema),
  storeController.updateShoppingVisit
);

// ==================== REVIEWS ====================

// Add store review
router.post(
  '/:storeId/reviews',
  validate(storeReviewSchema),
  storeController.addStoreReview
);

// Get store reviews
router.get('/:storeId/reviews', storeController.getStoreReviews);

module.exports = router;