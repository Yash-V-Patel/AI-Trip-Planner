const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

class StoreController {
  constructor() {
    // Bind all methods
    this.createStore = this.createStore.bind(this);
    this.getAllStores = this.getAllStores.bind(this);
    this.getStoreById = this.getStoreById.bind(this);
    this.updateStore = this.updateStore.bind(this);
    this.deleteStore = this.deleteStore.bind(this);
    this.addProduct = this.addProduct.bind(this);
    this.updateProduct = this.updateProduct.bind(this);
    this.deleteProduct = this.deleteProduct.bind(this);
    this.getStoreProducts = this.getStoreProducts.bind(this);
    this.createShoppingVisit = this.createShoppingVisit.bind(this);
    this.getShoppingVisits = this.getShoppingVisits.bind(this);
    this.updateShoppingVisit = this.updateShoppingVisit.bind(this);
    this.getNearbyStores = this.getNearbyStores.bind(this);
    this.getStoresByCity = this.getStoresByCity.bind(this);
    this.addStoreReview = this.addStoreReview.bind(this);
    this.getStoreReviews = this.getStoreReviews.bind(this);
    this.getMyStores = this.getMyStores.bind(this);
    this.getStoreAnalytics = this.getStoreAnalytics.bind(this);
    this.bulkImportProducts = this.bulkImportProducts.bind(this);
    this.updateStoreHours = this.updateStoreHours.bind(this);
    this.toggleStoreStatus = this.toggleStoreStatus.bind(this);
  }

  // ==================== HELPER METHODS ====================
  /**
   * Check if user can manage store
   */
  async canManageStore(user, storeId = null, action = "view") {
    try {
      // SuperAdmin always has access
      if (user?.isSuperAdmin) return true;

      if (!storeId) {
        // CREATING NEW STORE

        // First check if user has a vendor record
        const vendor = await prisma.vendor.findUnique({
          where: { userId: user?.id },
          select: {
            id: true,
            verificationStatus: true,
            isActive: true,
          },
        });

        if (!vendor) {
          console.log(
            `User ${user?.id} attempted to create store but has no vendor record`,
          );
          return false;
        }

        if (vendor.verificationStatus !== "VERIFIED") {
          console.log(`Vendor ${vendor.id} is not verified`);
          return false;
        }

        if (!vendor.isActive) {
          console.log(`Vendor ${vendor.id} is not active`);
          return false;
        }

        // Check if user has shopping permission (using vendor.id, not user.id)
        const canSellShopping =
          (await openfgaService.checkPermission?.(
            user?.id,
            "can_sell_shopping",
            `vendor:${vendor.id}`, // FIXED: Use vendor.id, not user.id
          )) || false;

        // Also check generic vendor status as fallback
        const isVendor = (await openfgaService.isVendor?.(user?.id)) || false;

        return canSellShopping || isVendor;
      }

      // FOR EXISTING STORES
      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { vendorId: true },
      });

      if (!store) return false;

      // Check if user owns this store (via vendor record)
      const vendor = await prisma.vendor.findUnique({
        where: { userId: user?.id },
      });

      if (vendor && store.vendorId === vendor.id) {
        // Owner can do everything
        return true;
      }

      // If not the owner, check OpenFGA permissions
      switch (action) {
        case "delete":
          return (
            (await openfgaService.canDeleteRetailStore?.(user?.id, storeId)) ||
            false
          );
        case "update":
          return (
            (await openfgaService.canUpdateRetailStore?.(user?.id, storeId)) ||
            false
          );
        case "edit":
          return (
            (await openfgaService.canEditRetailStore?.(user?.id, storeId)) ||
            false
          );
        case "view":
          return (
            (await openfgaService.canViewRetailStore?.(user?.id, storeId)) ||
            false
          );
        case "manage_products":
          return (
            (await openfgaService.canManageStoreProducts?.(
              user?.id,
              storeId,
            )) || false
          );
        default:
          return false;
      }
    } catch (error) {
      console.error("Error in canManageStore:", error);
      return false;
    }
  }
  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  // ==================== STORE MANAGEMENT ====================

  /**
   * Create a new store
   * POST /api/stores
   */
  async createStore(req, res, next) {
    try {
      // Check permission
      const canManage = await this.canManageStore(req.user);
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message:
            "Only approved vendors with shopping permissions can create stores",
        });
      }

      const storeData = req.body;

      // Convert contact info to string if present
      if (storeData.phone) {
        storeData.phone = String(storeData.phone);
      }

      // Add vendorId from vendor record
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id },
      });

      if (!vendor) {
        return res.status(404).json({
          success: false,
          message: "Vendor profile not found",
        });
      }

      storeData.vendorId = vendor.id;

      const store = await prisma.retailStore.create({
        data: storeData,
      });

      // Set up OpenFGA relations
      if (openfgaService.createRetailStoreRelations) {
        await openfgaService.createRetailStoreRelations(req.user.id, store.id);
      }

      // REMOVE this line - it tries to add permission again
      // No need to grant permission here as it should already be set during verification

      // Invalidate stores list cache
      await redisService.client?.del("stores:list:*");

      res.status(201).json({
        success: true,
        data: store,
        message: "Store created successfully",
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Get all stores with filtering
   * GET /api/stores
   */
  async getAllStores(req, res, next) {
    try {
      const {
        city,
        country,
        storeType,
        category,
        minRating,
        maxPrice,
        lat,
        lng,
        radius,
        page = 1,
        limit = 20,
        sortBy = "rating",
        sortOrder = "desc",
      } = req.query;

      // Build cache key
      const cacheKey = `stores:list:${city || ""}:${country || ""}:${storeType || ""}:${page}:${limit}`;

      // Try cache first
      let result = await redisService.client?.get(cacheKey);
      if (result && !req.query.skipCache) {
        return res.json({
          success: true,
          ...JSON.parse(result),
          cached: true,
        });
      }

      // Build filter
      const where = {};
      if (city) where.city = { contains: city, mode: "insensitive" };
      if (country) where.country = { contains: country, mode: "insensitive" };
      if (storeType) where.storeType = storeType;
      if (category)
        where.category = { contains: category, mode: "insensitive" };
      if (minRating) where.rating = { gte: parseFloat(minRating) };
      if (maxPrice)
        where.priceRange = this.getPriceRangeFromMax(parseInt(maxPrice));

      // Only show active stores
      where.isActive = true;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build orderBy
      const orderBy = {};
      orderBy[sortBy] = sortOrder;

      let stores = await prisma.retailStore.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy,
      });

      // If coordinates provided, filter by distance
      if (lat && lng && radius) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const maxDistance = parseFloat(radius);

        stores = stores.filter((store) => {
          if (store.latitude && store.longitude) {
            const distance = this.calculateDistance(
              userLat,
              userLng,
              store.latitude,
              store.longitude,
            );
            return distance <= maxDistance;
          }
          return false;
        });

        // Sort by distance
        stores.sort((a, b) => {
          const distA =
            a.latitude && a.longitude
              ? this.calculateDistance(
                  userLat,
                  userLng,
                  a.latitude,
                  a.longitude,
                )
              : Infinity;
          const distB =
            a.latitude && a.longitude
              ? this.calculateDistance(
                  userLat,
                  userLng,
                  b.latitude,
                  b.longitude,
                )
              : Infinity;
          return distA - distB;
        });
      }

      const total = stores.length;

      const response = {
        success: true,
        data: stores,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      };

      // Cache for 10 minutes
      await redisService.client?.setex(cacheKey, 600, JSON.stringify(response));

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get store by ID
   * GET /api/stores/:id
   */
  async getStoreById(req, res, next) {
    try {
      const { id } = req.params;

      // Try cache first
      const cacheKey = `store:${id}`;
      let store = await redisService.client?.get(cacheKey);

      if (store && !req.query.skipCache) {
        return res.json({
          success: true,
          data: JSON.parse(store),
          cached: true,
        });
      }

      store = await prisma.retailStore.findUnique({
        where: { id },
        include: {
          vendor: {
            select: {
              id: true,
              businessName: true,
              overallRating: true,
              isVerified: true,
            },
          },
          visits: {
            where: {
              status: "PLANNED",
              plannedDate: { gte: new Date() },
            },
            take: 5,
            orderBy: { plannedDate: "asc" },
          },
        },
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      // Check if store is active
      if (
        !store.isActive &&
        !req.user?.isSuperAdmin &&
        store.vendorId !== req.user?.id
      ) {
        return res.status(403).json({
          success: false,
          message: "This store is currently unavailable",
        });
      }

      // Parse products if they exist
      if (store.products) {
        store.products = JSON.parse(store.products);
      }

      // Cache for 1 hour
      await redisService.client?.setex(cacheKey, 3600, JSON.stringify(store));

      res.json({
        success: true,
        data: store,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get vendor's own stores
   * GET /api/stores/my-stores
   */
  async getMyStores(req, res, next) {
    try {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.id },
      });

      if (!vendor) {
        return res.json({
          success: true,
          data: [],
        });
      }

      const stores = await prisma.retailStore.findMany({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({
        success: true,
        data: stores,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update store
   * PUT /api/stores/:id
   */
  async updateStore(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageStore(req.user, id, "update");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own stores",
        });
      }

      const updateData = req.body;

      // Convert phone to string if present
      if (updateData.phone) {
        updateData.phone = String(updateData.phone);
      }

      // Don't allow changing vendorId
      delete updateData.vendorId;

      const store = await prisma.retailStore.update({
        where: { id },
        data: updateData,
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`store:${id}`),
        redisService.client?.del("stores:list:*"),
      ]);

      res.json({
        success: true,
        data: store,
        message: "Store updated successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }
      next(error);
    }
  }

  /**
   * Delete store
   * DELETE /api/stores/:id
   */
  async deleteStore(req, res, next) {
    try {
      const { id } = req.params;

      // Check permission
      const canManage = await this.canManageStore(req.user, id, "delete");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only delete your own stores",
        });
      }

      // Check if store has upcoming visits
      const upcomingVisits = await prisma.shoppingVisit.count({
        where: {
          storeId: id,
          status: "PLANNED",
          plannedDate: { gt: new Date() },
        },
      });

      if (upcomingVisits > 0) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot delete store with upcoming visits. Deactivate it instead.",
        });
      }

      await prisma.retailStore.delete({
        where: { id },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`store:${id}`),
        redisService.client?.del("stores:list:*"),
      ]);

      res.json({
        success: true,
        message: "Store deleted successfully",
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }
      next(error);
    }
  }

  /**
   * Toggle store active status
   * PATCH /api/stores/:id/toggle-status
   */
  async toggleStoreStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      // Check permission
      const canManage = await this.canManageStore(req.user, id, "update");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own stores",
        });
      }

      const store = await prisma.retailStore.update({
        where: { id },
        data: { isActive },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`store:${id}`),
        redisService.client?.del("stores:list:*"),
      ]);

      res.json({
        success: true,
        data: store,
        message: `Store ${isActive ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update store hours
   * PATCH /api/stores/:id/hours
   */
  async updateStoreHours(req, res, next) {
    try {
      const { id } = req.params;
      const { openingHours } = req.body;

      // Check permission
      const canManage = await this.canManageStore(req.user, id, "update");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own stores",
        });
      }

      const store = await prisma.retailStore.update({
        where: { id },
        data: { openingHours },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${id}`);

      res.json({
        success: true,
        data: store.openingHours,
        message: "Store hours updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PRODUCT MANAGEMENT ====================

  /**
   * Add product to store
   * POST /api/stores/:storeId/products
   */
  async addProduct(req, res, next) {
    try {
      const { storeId } = req.params;

      // Check permission
      const canManage = await this.canManageStore(
        req.user,
        storeId,
        "manage_products",
      );
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only add products to your own stores",
        });
      }

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { products: true },
      });

      let products = [];
      if (store.products) {
        products = JSON.parse(store.products);
      }

      const newProduct = {
        id: require("crypto").randomBytes(8).toString("hex"),
        ...req.body,
        createdAt: new Date().toISOString(),
      };

      products.push(newProduct);

      await prisma.retailStore.update({
        where: { id: storeId },
        data: { products: JSON.stringify(products) },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${storeId}`);

      res.status(201).json({
        success: true,
        data: newProduct,
        message: "Product added successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Bulk import products
   * POST /api/stores/:storeId/products/bulk
   */
  async bulkImportProducts(req, res, next) {
    try {
      const { storeId } = req.params;
      const { products } = req.body;

      // Check permission
      const canManage = await this.canManageStore(
        req.user,
        storeId,
        "manage_products",
      );
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only add products to your own stores",
        });
      }

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { products: true },
      });

      let existingProducts = [];
      if (store.products) {
        existingProducts = JSON.parse(store.products);
      }

      const newProducts = products.map((p) => ({
        id: require("crypto").randomBytes(8).toString("hex"),
        ...p,
        createdAt: new Date().toISOString(),
      }));

      const allProducts = [...existingProducts, ...newProducts];

      await prisma.retailStore.update({
        where: { id: storeId },
        data: { products: JSON.stringify(allProducts) },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${storeId}`);

      res.status(201).json({
        success: true,
        data: newProducts,
        message: `${newProducts.length} products imported successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get store products
   * GET /api/stores/:storeId/products
   */
  async getStoreProducts(req, res, next) {
    try {
      const { storeId } = req.params;
      const { category, minPrice, maxPrice, page = 1, limit = 20 } = req.query;

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { products: true },
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      let products = [];
      if (store.products) {
        products = JSON.parse(store.products);
      }

      // Apply filters
      if (category) {
        products = products.filter((p) => p.category === category);
      }
      if (minPrice) {
        products = products.filter((p) => p.price >= parseFloat(minPrice));
      }
      if (maxPrice) {
        products = products.filter((p) => p.price <= parseFloat(maxPrice));
      }

      // Pagination
      const start = (parseInt(page) - 1) * parseInt(limit);
      const paginatedProducts = products.slice(start, start + parseInt(limit));

      res.json({
        success: true,
        data: paginatedProducts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: products.length,
          pages: Math.ceil(products.length / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update product
   * PUT /api/stores/:storeId/products/:productId
   */
  async updateProduct(req, res, next) {
    try {
      const { storeId, productId } = req.params;

      // Check permission
      const canManage = await this.canManageStore(
        req.user,
        storeId,
        "manage_products",
      );
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only update products in your own stores",
        });
      }

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { products: true },
      });

      let products = [];
      if (store.products) {
        products = JSON.parse(store.products);
      }

      const productIndex = products.findIndex((p) => p.id === productId);
      if (productIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      products[productIndex] = {
        ...products[productIndex],
        ...req.body,
        updatedAt: new Date().toISOString(),
      };

      await prisma.retailStore.update({
        where: { id: storeId },
        data: { products: JSON.stringify(products) },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${storeId}`);

      res.json({
        success: true,
        data: products[productIndex],
        message: "Product updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete product
   * DELETE /api/stores/:storeId/products/:productId
   */
  async deleteProduct(req, res, next) {
    try {
      const { storeId, productId } = req.params;

      // Check permission
      const canManage = await this.canManageStore(
        req.user,
        storeId,
        "manage_products",
      );
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only delete products in your own stores",
        });
      }

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: { products: true },
      });

      let products = [];
      if (store.products) {
        products = JSON.parse(store.products);
      }

      const filteredProducts = products.filter((p) => p.id !== productId);

      await prisma.retailStore.update({
        where: { id: storeId },
        data: { products: JSON.stringify(filteredProducts) },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${storeId}`);

      res.json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHOPPING VISITS ====================

  /**
   * Create shopping visit (linked to travel plan)
   * POST /api/travel-plans/:travelPlanId/shopping-visits
   */
  async createShoppingVisit(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const visitData = req.body;

      // Check if user has permission to edit the travel plan
      const canEdit =
        (await openfgaService.canEditTravelPlan?.(req.user.id, travelPlanId)) ||
        false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to add shopping visits to this travel plan",
        });
      }

      // Validate store exists
      const store = await prisma.retailStore.findUnique({
        where: { id: visitData.storeId },
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      if (!store.isActive) {
        return res.status(400).json({
          success: false,
          message: "This store is currently closed",
        });
      }

      const visit = await prisma.shoppingVisit.create({
        data: {
          ...visitData,
          travelPlanId,
        },
        include: {
          store: true,
        },
      });

      // Set up OpenFGA relations
      if (openfgaService.createShoppingVisitRelations) {
        await openfgaService.createShoppingVisitRelations(
          req.user.id,
          visit.id,
          travelPlanId,
        );
      }

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${travelPlanId}`),
        redisService.client?.del(`store:${visitData.storeId}`),
      ]);

      res.status(201).json({
        success: true,
        data: visit,
        message: "Shopping visit created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get shopping visits for a travel plan
   * GET /api/travel-plans/:travelPlanId/shopping-visits
   */
  async getShoppingVisits(req, res, next) {
    try {
      const { travelPlanId } = req.params;

      // Check permission
      const canView =
        (await openfgaService.canViewTravelPlan?.(req.user.id, travelPlanId)) ||
        false;

      if (!canView && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to view these shopping visits",
        });
      }

      const visits = await prisma.shoppingVisit.findMany({
        where: { travelPlanId },
        include: {
          store: true,
        },
        orderBy: { plannedDate: "asc" },
      });

      res.json({
        success: true,
        data: visits,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update shopping visit
   * PUT /api/shopping-visits/:visitId
   */
  async updateShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      // Check permission via OpenFGA
      const canEdit =
        (await openfgaService.canEditShoppingVisit?.(req.user.id, visitId)) ||
        false;

      if (!canEdit && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this shopping visit",
        });
      }

      const visit = await prisma.shoppingVisit.findUnique({
        where: { id: visitId },
        include: { travelPlan: true },
      });

      if (!visit) {
        return res.status(404).json({
          success: false,
          message: "Shopping visit not found",
        });
      }

      // Don't allow updates to completed visits
      if (visit.status === "VISITED" || visit.status === "CANCELLED") {
        return res.status(400).json({
          success: false,
          message: `Cannot update visit with status: ${visit.status}`,
        });
      }

      const updatedVisit = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data: req.body,
        include: {
          store: true,
        },
      });

      // Invalidate caches
      await Promise.all([
        redisService.client?.del(`travelplan:${visit.travelPlanId}`),
        redisService.client?.del(`store:${visit.storeId}`),
      ]);

      res.json({
        success: true,
        data: updatedVisit,
        message: "Shopping visit updated successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== STORE DISCOVERY ====================

  /**
   * Get nearby stores
   * GET /api/stores/nearby
   */
  async getNearbyStores(req, res, next) {
    try {
      const { lat, lng, radius = 5, limit = 20 } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: "Latitude and longitude are required",
        });
      }

      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxDistance = parseFloat(radius);

      const stores = await prisma.retailStore.findMany({
        where: {
          isActive: true,
          latitude: { not: null },
          longitude: { not: null },
        },
      });

      // Calculate distances and filter
      const storesWithDistance = stores
        .map((store) => ({
          ...store,
          distance: this.calculateDistance(
            userLat,
            userLng,
            store.latitude,
            store.longitude,
          ),
        }))
        .filter((store) => store.distance <= maxDistance)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, parseInt(limit));

      res.json({
        success: true,
        data: storesWithDistance,
        count: storesWithDistance.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get stores by city
   * GET /api/stores/city/:city
   */
  async getStoresByCity(req, res, next) {
    try {
      const { city } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [stores, total] = await Promise.all([
        prisma.retailStore.findMany({
          where: {
            city: { contains: city, mode: "insensitive" },
            isActive: true,
          },
          skip,
          take: parseInt(limit),
          orderBy: { rating: "desc" },
        }),
        prisma.retailStore.count({
          where: {
            city: { contains: city, mode: "insensitive" },
            isActive: true,
          },
        }),
      ]);

      res.json({
        success: true,
        data: stores,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REVIEWS ====================

  /**
   * Add store review
   * POST /api/stores/:storeId/reviews
   */
  async addStoreReview(req, res, next) {
    try {
      const { storeId } = req.params;
      const { rating, comment } = req.body;

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }

      // Check if user already reviewed
      // Note: You'd need a StoreReview model for this
      // For now, we'll just update store rating

      const newRating = store.rating
        ? (store.rating * store.totalReviews + rating) /
          (store.totalReviews + 1)
        : rating;

      await prisma.retailStore.update({
        where: { id: storeId },
        data: {
          rating: newRating,
          totalReviews: (store.totalReviews || 0) + 1,
        },
      });

      // Invalidate cache
      await redisService.client?.del(`store:${storeId}`);

      res.json({
        success: true,
        message: "Review added successfully",
        data: {
          newRating,
          totalReviews: store.totalReviews + 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get store reviews
   * GET /api/stores/:storeId/reviews
   */
  async getStoreReviews(req, res, next) {
    try {
      const { storeId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      // Note: You'd need a StoreReview model for this
      // For now, return store rating info

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId },
        select: {
          rating: true,
          totalReviews: true,
        },
      });

      res.json({
        success: true,
        data: {
          averageRating: store?.rating || 0,
          totalReviews: store?.totalReviews || 0,
          reviews: [], // Empty array until you implement reviews
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: store?.totalReviews || 0,
          pages: Math.ceil((store?.totalReviews || 0) / parseInt(limit)),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ANALYTICS ====================

  /**
   * Get store analytics (vendor only)
   * GET /api/stores/:storeId/analytics
   */
  async getStoreAnalytics(req, res, next) {
    try {
      const { storeId } = req.params;

      // Check permission
      const canManage = await this.canManageStore(req.user, storeId, "view");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          message: "You can only view analytics for your own stores",
        });
      }

      const [store, visits, upcomingVisits, completedVisits] =
        await Promise.all([
          prisma.retailStore.findUnique({
            where: { id: storeId },
            select: {
              rating: true,
              totalReviews: true,
              isActive: true,
              createdAt: true,
            },
          }),
          prisma.shoppingVisit.count({
            where: { storeId },
          }),
          prisma.shoppingVisit.count({
            where: {
              storeId,
              status: "PLANNED",
              plannedDate: { gt: new Date() },
            },
          }),
          prisma.shoppingVisit.count({
            where: {
              storeId,
              status: "VISITED",
            },
          }),
        ]);

      // Get monthly trends
      const monthlyVisits = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', planned_date) as month,
          COUNT(*) as count
        FROM shopping_visits
        WHERE store_id = ${storeId}
        GROUP BY DATE_TRUNC('month', planned_date)
        ORDER BY month DESC
        LIMIT 6
      `;

      res.json({
        success: true,
        data: {
          store: {
            rating: store?.rating,
            totalReviews: store?.totalReviews,
            isActive: store?.isActive,
            createdAt: store?.createdAt,
          },
          stats: {
            totalVisits: visits,
            upcomingVisits,
            completedVisits,
            conversionRate: visits > 0 ? (completedVisits / visits) * 100 : 0,
          },
          trends: monthlyVisits,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== HELPER METHODS ====================

  getPriceRangeFromMax(maxPrice) {
    if (maxPrice < 50) return "BUDGET";
    if (maxPrice < 200) return "MODERATE";
    if (maxPrice < 500) return "EXPENSIVE";
    return "LUXURY";
  }
}

module.exports = new StoreController();
