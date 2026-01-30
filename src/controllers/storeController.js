const prisma = require('../config/prisma');

const storeController = {
  // Create a store visit plan
  createStore: async (req, res, next) => {
    try {
      const { tripId } = req.params;
      const storeData = req.body;

      // Check if trip exists
      const trip = await prisma.trip.findUnique({
        where: { id: tripId }
      });

      if (!trip) {
        return res.status(404).json({
          error: 'Trip not found'
        });
      }

      // Create store plan
      const store = await prisma.store.create({
        data: {
          ...storeData,
          tripId,
          plannedDate: new Date(storeData.plannedDate)
        }
      });

      res.status(201).json({
        success: true,
        message: 'Store visit planned successfully',
        data: store
      });
    } catch (error) {
      next(error);
    }
  },

  // Get all stores for a trip
  getTripStores: async (req, res, next) => {
    try {
      const { tripId } = req.params;

      const stores = await prisma.store.findMany({
        where: { tripId },
        orderBy: {
          plannedDate: 'asc'
        }
      });

      res.json({
        success: true,
        count: stores.length,
        data: stores
      });
    } catch (error) {
      next(error);
    }
  },

  // Get single store
  getStoreById: async (req, res, next) => {
    try {
      const { storeId } = req.params;

      const store = await prisma.store.findUnique({
        where: { id: storeId }
      });

      if (!store) {
        return res.status(404).json({
          error: 'Store plan not found'
        });
      }

      res.json({
        success: true,
        data: store
      });
    } catch (error) {
      next(error);
    }
  },

  // Update store plan
  updateStore: async (req, res, next) => {
    try {
      const { storeId } = req.params;
      const updates = req.body;

      const store = await prisma.store.update({
        where: { id: storeId },
        data: updates
      });

      res.json({
        success: true,
        message: 'Store plan updated successfully',
        data: store
      });
    } catch (error) {
      next(error);
    }
  },

  // Delete store plan
  deleteStore: async (req, res, next) => {
    try {
      const { storeId } = req.params;

      await prisma.store.delete({
        where: { id: storeId }
      });

      res.json({
        success: true,
        message: 'Store plan deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  },

  // Update store status and spending
  updateStoreVisit: async (req, res, next) => {
    try {
      const { storeId } = req.params;
      const { status, spent, items } = req.body;

      const store = await prisma.store.update({
        where: { id: storeId },
        data: {
          status,
          spent,
          items: items ? JSON.stringify(items) : undefined
        }
      });

      res.json({
        success: true,
        message: 'Store visit updated successfully',
        data: store
      });
    } catch (error) {
      next(error);
    }
  },

  // Get store recommendations
  getStoreRecommendations: async (req, res, next) => {
    try {
      const { destination, category, budget } = req.query;

      // This would integrate with external APIs or AI
      // For now, return mock data
      const recommendations = [
        {
          name: "Mall of the City",
          type: "SHOPPING",
          category: "Department Store",
          address: "789 Shopping Ave",
          rating: 4.2,
          priceRange: "$$",
          popularFor: ["Clothing", "Electronics", "Food Court"]
        },
        {
          name: "Local Souvenir Market",
          type: "SOUVENIR_SHOP",
          category: "Handicrafts",
          address: "321 Cultural St",
          rating: 4.5,
          priceRange: "$",
          popularFor: ["Local crafts", "Traditional items", "Gifts"]
        }
      ];

      res.json({
        success: true,
        data: recommendations
      });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = storeController;