"use strict";

const { randomUUID } = require("crypto");
const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_CACHE_TTL_S      = 3600; // 1 hour
const STORE_LIST_CACHE_TTL_S = 600;  // 10 minutes
const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 20;

// ShoppingVisitStatus terminal values
const TERMINAL_VISIT_STATUSES = ["VISITED", "CANCELLED", "SKIPPED"];

// PriceRange enum: BUDGET | MODERATE | EXPENSIVE | LUXURY
const PRICE_RANGE_THRESHOLDS = [
  { max: 50,  range: "BUDGET"   },
  { max: 200, range: "MODERATE" },
  { max: 500, range: "EXPENSIVE"},
];

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt", "name", "rating", "city",
]);

// Earth radius in km — used by Haversine
const EARTH_RADIUS_KM = 6371;

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

const notFound   = (res, msg = "Resource not found") => res.status(404).json({ success: false, message: msg });
const forbidden  = (res, msg = "Unauthorized access") => res.status(403).json({ success: false, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, message: msg });

const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseFloatParam = (val, fallback) => {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
};

const parsePagination = (query, defaultLimit = DEFAULT_LIMIT) => {
  const page  = parseIntParam(query.page,  DEFAULT_PAGE);
  const limit = parseIntParam(query.limit, defaultLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const buildPaginationMeta = (page, limit, total) => ({
  page, limit, total, pages: Math.ceil(total / limit),
});

/**
 * Map a numeric max-price to the correct PriceRange enum value.
 * PriceRange enum: BUDGET | MODERATE | EXPENSIVE | LUXURY
 */
const getPriceRangeFromMax = (maxPrice) => {
  for (const { max, range } of PRICE_RANGE_THRESHOLDS) {
    if (maxPrice < max) return range;
  }
  return "LUXURY";
};

/**
 * Invalidate the single-store cache and list pattern.
 * Fire-and-forget — never blocks a response.
 */
const invalidateStoreCache = (storeId) =>
  Promise.allSettled([
    redisService.client?.del(`store:${storeId}`),
    // FIX: Redis `del` does not support globs — use deletePattern for wildcard
    redisService.deletePattern?.("stores:list:*"),
  ]);

// ---------------------------------------------------------------------------
// Haversine distance helpers (pure functions — no `this` needed)
// ---------------------------------------------------------------------------

const toRad = (deg) => deg * (Math.PI / 180);

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the vendor record (id only) for a user IF verified and active.
 */
const getActiveVendor = (userId) =>
  prisma.vendor.findFirst({
    where:  { userId, verificationStatus: "VERIFIED", isActive: true },
    select: { id: true },
  });

/**
 * Decide whether `user` may manage `storeId`.
 *
 * BUG FIX: original `getStoreById` checked `store.vendorId !== req.user?.id`
 * (Vendor.id vs User.id — different ID spaces). All ownership checks now
 * correctly compare store.vendorId ↔ vendor.id.
 *
 * BUG FIX: creation guard now uses `getActiveVendor` (verified + active),
 * consistent with accommodation and transportation controllers.
 */
const canManageStore = async (user, storeId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;
  if (!user?.id) return false;

  if (!storeId) {
    // Creation guard: must be a verified, active vendor
    const vendor = await getActiveVendor(user.id);
    return !!vendor;
  }

  const [vendor, store] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.retailStore.findUnique({ where: { id: storeId }, select: { vendorId: true } }),
  ]);

  if (!store) return false;

  // Vendor owns this store
  if (vendor && store.vendorId === vendor.id) return true;

  // OpenFGA fallback for team members
  const fgaFns = {
    delete:          openfgaService.canDeleteRetailStore,
    update:          openfgaService.canEditRetailStore,
    edit:            openfgaService.canEditRetailStore,
    view:            openfgaService.canViewRetailStore,
    manage_products: openfgaService.canManageStoreProducts,
    update_inventory: openfgaService.canUpdateStoreInventory,
  };
  return !!(await fgaFns[action]?.(user.id, storeId).catch(() => false));
};

// ---------------------------------------------------------------------------
// Product helpers
// ---------------------------------------------------------------------------

/**
 * Safely read the products Json field.
 *
 * BUG FIX: `products` is a Prisma `Json?` field — Prisma returns it as a
 * native JS value (array or null), NOT as a JSON string. The original
 * `JSON.parse(store.products)` would throw a SyntaxError because you cannot
 * parse an object/array — only strings.  Just return the value directly.
 */
const parseProducts = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // Defensive: if somehow stored as a string (e.g. via a raw SQL insert)
  if (typeof raw === "string") return JSON.parse(raw);
  return [];
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class StoreController {

  // ==================== STORE MANAGEMENT ====================

  /**
   * POST /api/stores
   * Create — approved shopping vendors only
   */
  async createStore(req, res, next) {
    try {
      const canCreate = await canManageStore(req.user);
      if (!canCreate) return forbidden(res, "Only approved vendors with shopping permissions can create stores");

      const vendor = await prisma.vendor.findUnique({
        where:  { userId: req.user.id },
        select: { id: true },
      });
      if (!vendor) return forbidden(res, "Vendor profile not found");

      const {
        name, description, storeType, address, city, country,
        latitude, longitude, phone, email, website,
        openingHours, priceRange, images, category,
      } = req.body;

      const store = await prisma.retailStore.create({
        data: {
          vendorId: vendor.id,
          name, address, city, country,
          ...(description  !== undefined && { description }),
          ...(storeType    !== undefined && { storeType }),
          ...(latitude     !== undefined && { latitude }),
          ...(longitude    !== undefined && { longitude }),
          ...(phone        !== undefined && { phone: String(phone) }),
          ...(email        !== undefined && { email }),
          ...(website      !== undefined && { website }),
          ...(openingHours !== undefined && { openingHours }),
          ...(priceRange   !== undefined && { priceRange }),
          ...(category     !== undefined && { category }),
          images:           images ?? [],
        },
      });

      // OpenFGA + list cache (fire-and-forget)
      Promise.allSettled([
        openfgaService.createRetailStoreRelations(req.user.id, store.id),
        redisService.deletePattern?.("stores:list:*"),
      ]);

      return res.status(201).json({ success: true, data: store, message: "Store created successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores
   * Public listing with filtering, search, and optional geo-proximity.
   *
   * BUG FIX: original fetched `limit` records from DB THEN filtered by
   * distance in memory — so the result set was short and total was wrong.
   * Fix: when geo params (lat/lng/radius) are present, geo-filter is applied
   * after fetching all candidate records (no DB skip/take), then paginated
   * in memory. Without geo params, normal DB pagination is used.
   *
   * BUG FIX: `sortBy` is now whitelisted to prevent field-injection attacks.
   */
  async getAllStores(req, res, next) {
    try {
      const {
        city, country, storeType, category, search,
        minRating, maxPrice, lat, lng, radius,
        sortBy = "rating", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const skipCache = req.query.skipCache === "true";
      const hasGeo    = lat && lng && radius;

      // Only cache non-geo requests (geo results vary per coordinate)
      if (!hasGeo && !skipCache) {
        const cacheKey = `stores:list:${city ?? ""}:${country ?? ""}:${storeType ?? ""}:${page}:${limit}`;
        const cached   = await redisService.client?.get(cacheKey).catch(() => null);
        if (cached) {
          return res.json({ success: true, ...JSON.parse(cached), cached: true });
        }
      }

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "rating";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [{ isActive: true }];

      if (city)      AND.push({ city:      { contains: city,      mode: "insensitive" } });
      if (country)   AND.push({ country:   { contains: country,   mode: "insensitive" } });
      if (storeType) AND.push({ storeType });
      if (category)  AND.push({ category:  { contains: category,  mode: "insensitive" } });
      if (minRating) AND.push({ rating:    { gte: parseFloatParam(minRating, 0) } });
      if (maxPrice)  AND.push({ priceRange: getPriceRangeFromMax(parseIntParam(maxPrice, 0)) });

      // Separate AND clause for keyword search (never overwrites location filter)
      if (search) {
        AND.push({
          OR: [
            { name:        { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      // Geo filter: must have coordinates in DB
      if (hasGeo) AND.push({ latitude: { not: null }, longitude: { not: null } });

      if (hasGeo) {
        // Fetch all candidates (no DB pagination), filter + paginate in memory
        const allStores = await prisma.retailStore.findMany({
          where:   { AND },
          orderBy: { [safeSortBy]: safeSortOrder },
        });

        const userLat    = parseFloatParam(lat, 0);
        const userLng    = parseFloatParam(lng, 0);
        const maxDistKm  = parseFloatParam(radius, 5);

        const withDist = allStores
          .map((s) => ({ ...s, distanceKm: haversineKm(userLat, userLng, s.latitude, s.longitude) }))
          .filter((s) => s.distanceKm <= maxDistKm)
          .sort((a, b) => a.distanceKm - b.distanceKm);

        const total     = withDist.length;
        const paginated = withDist.slice(skip, skip + limit);

        return res.json({
          success: true,
          data:       paginated,
          pagination: buildPaginationMeta(page, limit, total),
          filters: { city: city ?? null, country: country ?? null, storeType: storeType ?? null,
                     search: search ?? null, lat, lng, radius },
        });
      }

      // Standard DB pagination
      const [stores, total] = await Promise.all([
        prisma.retailStore.findMany({
          where:   { AND },
          skip,
          take:    limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.retailStore.count({ where: { AND } }),
      ]);

      const responseBody = {
        data:       stores,
        pagination: buildPaginationMeta(page, limit, total),
        filters: { city: city ?? null, country: country ?? null, storeType: storeType ?? null,
                   search: search ?? null },
      };

      // Cache non-geo, non-search results
      if (!search) {
        const cacheKey = `stores:list:${city ?? ""}:${country ?? ""}:${storeType ?? ""}:${page}:${limit}`;
        redisService.client
          ?.setex(cacheKey, STORE_LIST_CACHE_TTL_S, JSON.stringify(responseBody))
          .catch(() => {});
      }

      return res.json({ success: true, ...responseBody });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores/:id
   * Public.
   *
   * BUG FIX: inactive store was returning 403 (leaks existence to public).
   *          Now returns 404 for non-superadmin clients.
   *
   * BUG FIX: vendor select included `isVerified` which does not exist on
   *          the Vendor model (model has `verificationStatus`). Fixed.
   *
   * BUG FIX: ownership check was `store.vendorId !== req.user?.id`
   *          (Vendor.id vs User.id). Removed — not needed for public read.
   */
  async getStoreById(req, res, next) {
    try {
      const { id } = req.params;
      const skipCache = req.query.skipCache === "true";

      if (!skipCache) {
        const cached = await redisService.client?.get(`store:${id}`).catch(() => null);
        if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });
      }

      const store = await prisma.retailStore.findUnique({
        where:   { id },
        include: {
          vendor: {
            select: {
              id: true, businessName: true,
              overallRating: true, verificationStatus: true,
            },
          },
          visits: {
            where:   { status: "PLANNED", plannedDate: { gte: new Date() } },
            take:    5,
            orderBy: { plannedDate: "asc" },
            select:  { id: true, plannedDate: true, status: true },
          },
          _count: { select: { visits: true } },
        },
      });

      if (!store || (!store.isActive && !req.user?.isSuperAdmin)) {
        return notFound(res, "Store not found");
      }

      redisService.client
        ?.setex(`store:${id}`, STORE_CACHE_TTL_S, JSON.stringify(store))
        .catch(() => {});

      return res.json({ success: true, data: store, cached: false });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores/my-stores
   * Vendor — their own listings, includes inactive, paginated.
   */
  async getMyStores(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const vendor = await prisma.vendor.findUnique({
        where:  { userId },
        select: { id: true },
      });
      if (!vendor) return notFound(res, "Vendor profile not found");

      const where = {
        vendorId: vendor.id,
        ...(status === "active"   && { isActive: true }),
        ...(status === "inactive" && { isActive: false }),
      };

      const [stores, total] = await Promise.all([
        prisma.retailStore.findMany({
          where,
          include: { _count: { select: { visits: true } } },
          skip,
          take:    limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.retailStore.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       stores,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/stores/:id
   * Sparse update — vendorId never writable
   */
  async updateStore(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.retailStore.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const allowed = await canManageStore(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only update your own stores");

      const {
        name, description, storeType, address, city, country,
        latitude, longitude, phone, email, website,
        openingHours, priceRange, images, category,
        isActive,
      } = req.body;

      const store = await prisma.retailStore.update({
        where: { id },
        data: {
          ...(name         !== undefined && { name }),
          ...(description  !== undefined && { description }),
          ...(storeType    !== undefined && { storeType }),
          ...(address      !== undefined && { address }),
          ...(city         !== undefined && { city }),
          ...(country      !== undefined && { country }),
          ...(latitude     !== undefined && { latitude }),
          ...(longitude    !== undefined && { longitude }),
          ...(phone        !== undefined && { phone: String(phone) }),
          ...(email        !== undefined && { email }),
          ...(website      !== undefined && { website }),
          ...(openingHours !== undefined && { openingHours }),
          ...(priceRange   !== undefined && { priceRange }),
          ...(images       !== undefined && { images }),
          ...(category     !== undefined && { category }),
          // isActive writable by superadmin only here; vendors use PATCH /status
          ...(req.user.isSuperAdmin && isActive !== undefined && { isActive }),
        },
      });

      invalidateStoreCache(id);

      return res.json({ success: true, data: store, message: "Store updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Store not found");
      next(error);
    }
  }

  /**
   * DELETE /api/stores/:id
   */
  async deleteStore(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.retailStore.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const allowed = await canManageStore(req.user, id, "delete");
      if (!allowed) return forbidden(res, "You can only delete your own stores");

      const upcomingVisits = await prisma.shoppingVisit.count({
        where: { storeId: id, status: "PLANNED", plannedDate: { gt: new Date() } },
      });

      if (upcomingVisits > 0) {
        return badRequest(res, "Cannot delete store with upcoming visits. Deactivate it instead.");
      }

      await prisma.retailStore.delete({ where: { id } });
      invalidateStoreCache(id);

      return res.json({ success: true, message: "Store deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Store not found");
      next(error);
    }
  }

  /**
   * PATCH /api/stores/:id/status
   * Vendor — toggle active/inactive with boolean validation
   */
  async toggleStoreStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");

      const existing = await prisma.retailStore.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const allowed = await canManageStore(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only manage your own stores");

      const store = await prisma.retailStore.update({
        where:  { id },
        data:   { isActive },
        select: { id: true, name: true, isActive: true },
      });

      invalidateStoreCache(id);

      return res.json({
        success: true,
        data: store,
        message: `Store ${isActive ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Store not found");
      next(error);
    }
  }

  /**
   * PATCH /api/stores/:id/hours
   */
  async updateStoreHours(req, res, next) {
    try {
      const { id } = req.params;
      const { openingHours } = req.body;

      if (openingHours === undefined) return badRequest(res, "openingHours is required");

      const existing = await prisma.retailStore.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const allowed = await canManageStore(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only update your own stores");

      const store = await prisma.retailStore.update({
        where:  { id },
        data:   { openingHours },
        select: { id: true, name: true, openingHours: true },
      });

      redisService.client?.del(`store:${id}`).catch(() => {});

      return res.json({ success: true, data: store.openingHours, message: "Store hours updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Store not found");
      next(error);
    }
  }

  // ==================== PRODUCT MANAGEMENT ====================
  //
  // NOTE: `products` is a Prisma `Json?` field on RetailStore.
  // Prisma returns it as a native JS value — NEVER JSON.parse/stringify.
  // BUG FIX: All original methods called `JSON.parse(store.products)` which
  // throws SyntaxError because the value is already a JS object/array.

  /**
   * POST /api/stores/:storeId/products
   */
  async addProduct(req, res, next) {
    try {
      const { storeId } = req.params;

      const allowed = await canManageStore(req.user, storeId, "manage_products");
      if (!allowed) return forbidden(res, "You can only add products to your own stores");

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, products: true },
      });
      if (!store) return notFound(res, "Store not found");

      const products = parseProducts(store.products);

      const newProduct = {
        id:        randomUUID(),
        ...req.body,
        createdAt: new Date().toISOString(),
      };

      products.push(newProduct);

      // Write back as native JS array — Prisma serialises Json fields automatically
      await prisma.retailStore.update({
        where: { id: storeId },
        data:  { products },
      });

      redisService.client?.del(`store:${storeId}`).catch(() => {});

      return res.status(201).json({ success: true, data: newProduct, message: "Product added successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/stores/:storeId/products/bulk
   */
  async bulkImportProducts(req, res, next) {
    try {
      const { storeId } = req.params;
      const { products: incoming } = req.body;

      if (!Array.isArray(incoming) || incoming.length === 0) {
        return badRequest(res, "products must be a non-empty array");
      }

      const allowed = await canManageStore(req.user, storeId, "manage_products");
      if (!allowed) return forbidden(res, "You can only add products to your own stores");

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, products: true },
      });
      if (!store) return notFound(res, "Store not found");

      const existing = parseProducts(store.products);

      const newProducts = incoming.map((p) => ({
        id:        randomUUID(),
        ...p,
        createdAt: new Date().toISOString(),
      }));

      await prisma.retailStore.update({
        where: { id: storeId },
        data:  { products: [...existing, ...newProducts] },
      });

      redisService.client?.del(`store:${storeId}`).catch(() => {});

      return res.status(201).json({
        success: true,
        data:    newProducts,
        message: `${newProducts.length} product(s) imported successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores/:storeId/products
   */
  async getStoreProducts(req, res, next) {
    try {
      const { storeId } = req.params;
      const { category, minPrice, maxPrice } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, products: true },
      });
      if (!store) return notFound(res, "Store not found");

      let products = parseProducts(store.products);

      if (category) products = products.filter((p) => p.category === category);
      if (minPrice) products = products.filter((p) => (p.price ?? 0) >= parseFloatParam(minPrice, 0));
      if (maxPrice) products = products.filter((p) => (p.price ?? 0) <= parseFloatParam(maxPrice, Infinity));

      const total     = products.length;
      const paginated = products.slice(skip, skip + limit);

      return res.json({
        success: true,
        data:       paginated,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/stores/:storeId/products/:productId
   */
  async updateProduct(req, res, next) {
    try {
      const { storeId, productId } = req.params;

      const allowed = await canManageStore(req.user, storeId, "manage_products");
      if (!allowed) return forbidden(res, "You can only update products in your own stores");

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, products: true },
      });
      if (!store) return notFound(res, "Store not found");

      const products = parseProducts(store.products);
      const idx      = products.findIndex((p) => p.id === productId);
      if (idx === -1) return notFound(res, "Product not found");

      products[idx] = { ...products[idx], ...req.body, updatedAt: new Date().toISOString() };

      await prisma.retailStore.update({
        where: { id: storeId },
        data:  { products },
      });

      redisService.client?.del(`store:${storeId}`).catch(() => {});

      return res.json({ success: true, data: products[idx], message: "Product updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/stores/:storeId/products/:productId
   */
  async deleteProduct(req, res, next) {
    try {
      const { storeId, productId } = req.params;

      const allowed = await canManageStore(req.user, storeId, "manage_products");
      if (!allowed) return forbidden(res, "You can only delete products in your own stores");

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, products: true },
      });
      if (!store) return notFound(res, "Store not found");

      const products  = parseProducts(store.products);
      const filtered  = products.filter((p) => p.id !== productId);

      if (filtered.length === products.length) return notFound(res, "Product not found");

      await prisma.retailStore.update({
        where: { id: storeId },
        data:  { products: filtered },
      });

      redisService.client?.del(`store:${storeId}`).catch(() => {});

      return res.json({ success: true, message: "Product deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SHOPPING VISITS ====================

  /**
   * POST /api/travel-plans/:travelPlanId/shopping-visits
   */
  async createShoppingVisit(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const {
        storeId, plannedDate, purpose, plannedItems, duration, aiNotes, recommendations,
      } = req.body;

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelPlan?.(req.user.id, travelPlanId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to add shopping visits to this travel plan");

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, isActive: true },
      });

      if (!store)          return notFound(res, "Store not found");
      if (!store.isActive) return badRequest(res, "This store is currently closed");

      if (!plannedDate) return badRequest(res, "plannedDate is required");

      const visit = await prisma.shoppingVisit.create({
        data: {
          travelPlanId,
          storeId,
          plannedDate:   new Date(plannedDate),
          ...(purpose       !== undefined && { purpose }),
          ...(plannedItems  !== undefined && { plannedItems }),
          ...(duration      !== undefined && { duration }),
          ...(aiNotes       !== undefined && { aiNotes }),
          ...(recommendations !== undefined && { recommendations }),
        },
        include: { store: { select: { id: true, name: true, city: true, storeType: true } } },
      });

      Promise.allSettled([
        openfgaService.createShoppingVisitRelations(req.user.id, visit.id, travelPlanId),
        redisService.client?.del(`travelplan:${travelPlanId}`),
      ]);

      return res.status(201).json({
        success: true,
        data:    visit,
        message: "Shopping visit created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/travel-plans/:travelPlanId/shopping-visits
   */
  async getShoppingVisits(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const { status } = req.query;

      const canView =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canViewTravelPlan?.(req.user.id, travelPlanId).catch(() => false));

      if (!canView) return forbidden(res, "You do not have permission to view these shopping visits");

      const visits = await prisma.shoppingVisit.findMany({
        where: {
          travelPlanId,
          ...(status && { status }),
        },
        include: { store: { select: { id: true, name: true, city: true, storeType: true, rating: true } } },
        orderBy: { plannedDate: "asc" },
      });

      return res.json({ success: true, data: visits });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/shopping-visits/:visitId
   * FIX: existence check before permission check.
   * FIX: sparse update replaces `req.body` pass-through.
   */
  async updateShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      // Existence check first for clean 404
      const visit = await prisma.shoppingVisit.findUnique({
        where:  { id: visitId },
        select: { status: true, travelPlanId: true, storeId: true },
      });
      if (!visit) return notFound(res, "Shopping visit not found");

      if (TERMINAL_VISIT_STATUSES.includes(visit.status)) {
        return badRequest(res, `Cannot update visit with status: ${visit.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditShoppingVisit?.(req.user.id, visitId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this shopping visit");

      const {
        plannedDate, actualVisitDate, duration, purpose, plannedItems, status, aiNotes, recommendations,
      } = req.body;

      const updated = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data: {
          ...(plannedDate     !== undefined && { plannedDate:     new Date(plannedDate) }),
          ...(actualVisitDate !== undefined && { actualVisitDate: new Date(actualVisitDate) }),
          ...(duration        !== undefined && { duration }),
          ...(purpose         !== undefined && { purpose }),
          ...(plannedItems    !== undefined && { plannedItems }),
          ...(status          !== undefined && { status }),
          ...(aiNotes         !== undefined && { aiNotes }),
          ...(recommendations !== undefined && { recommendations }),
        },
        include: { store: { select: { id: true, name: true, city: true } } },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${visit.travelPlanId}`),
        redisService.client?.del(`store:${visit.storeId}`),
      ]);

      return res.json({ success: true, data: updated, message: "Shopping visit updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/shopping-visits/:visitId  [NEW]
   * Cancel a shopping visit
   */
  async cancelShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      const visit = await prisma.shoppingVisit.findUnique({
        where:  { id: visitId },
        select: { status: true, travelPlanId: true, storeId: true },
      });
      if (!visit) return notFound(res, "Shopping visit not found");
      if (visit.status === "CANCELLED") return badRequest(res, "Visit is already cancelled");
      if (visit.status === "VISITED")   return badRequest(res, "Cannot cancel a completed visit");

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditShoppingVisit?.(req.user.id, visitId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to cancel this shopping visit");

      const cancelled = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data:  { status: "CANCELLED" },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${visit.travelPlanId}`),
        redisService.client?.del(`store:${visit.storeId}`),
      ]);

      return res.json({ success: true, data: cancelled, message: "Shopping visit cancelled successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== STORE DISCOVERY ====================

  /**
   * GET /api/stores/nearby
   * Public — Haversine in memory (use PostGIS for scale).
   */
  async getNearbyStores(req, res, next) {
    try {
      const { lat, lng, radius = "5", limit: limitQ = "20" } = req.query;

      if (!lat || !lng) return badRequest(res, "Latitude and longitude are required");

      const userLat   = parseFloatParam(lat, 0);
      const userLng   = parseFloatParam(lng, 0);
      const maxDistKm = parseFloatParam(radius, 5);
      const maxCount  = parseIntParam(limitQ, 20);

      const stores = await prisma.retailStore.findMany({
        where: { isActive: true, latitude: { not: null }, longitude: { not: null } },
        select: {
          id: true, name: true, address: true, city: true, country: true,
          storeType: true, category: true, rating: true, priceRange: true,
          latitude: true, longitude: true, openingHours: true, images: true,
        },
      });

      const result = stores
        .map((s) => ({ ...s, distanceKm: +haversineKm(userLat, userLng, s.latitude, s.longitude).toFixed(2) }))
        .filter((s) => s.distanceKm <= maxDistKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, maxCount);

      return res.json({ success: true, data: result, count: result.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores/city/:city
   */
  async getStoresByCity(req, res, next) {
    try {
      const { city } = req.params;
      const { page, limit, skip } = parsePagination(req.query);

      const where = { city: { contains: city, mode: "insensitive" }, isActive: true };

      const [stores, total] = await Promise.all([
        prisma.retailStore.findMany({ where, skip, take: limit, orderBy: { rating: "desc" } }),
        prisma.retailStore.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       stores,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REVIEWS ====================
  //
  // NOTE: RetailStore has no `totalReviews` field in the Prisma schema.
  // BUG FIX: all `store.totalReviews` references removed.
  // Reviews are tracked via VendorReview (which has vendorId, userId, rating,
  // comment). Store-specific review counts are derived from ShoppingVisit
  // (status=VISITED) as a proxy until a StoreReview model is added.

  /**
   * POST /api/stores/:storeId/reviews
   * Updates the store's aggregated `rating` field in-place.
   * For a production-grade approach, add a StoreReview model.
   */
  async addStoreReview(req, res, next) {
    try {
      const { storeId } = req.params;
      const { rating, comment } = req.body;

      if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
        return badRequest(res, "rating must be a number between 1 and 5");
      }

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, rating: true },
      });
      if (!store) return notFound(res, "Store not found");

      // Derive review count from completed visits as proxy
      const visitCount = await prisma.shoppingVisit.count({
        where: { storeId, status: "VISITED" },
      });

      const currentRating = store.rating ?? 0;
      const newRating     = visitCount > 0
        ? +((currentRating * visitCount + rating) / (visitCount + 1)).toFixed(2)
        : rating;

      await prisma.retailStore.update({
        where: { id: storeId },
        data:  { rating: newRating },
      });

      redisService.client?.del(`store:${storeId}`).catch(() => {});

      return res.json({
        success: true,
        message: "Review submitted successfully",
        data:    { newRating, basedOnVisits: visitCount + 1 },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/stores/:storeId/reviews
   * Returns aggregated rating + visit-based distribution until StoreReview is added.
   */
  async getStoreReviews(req, res, next) {
    try {
      const { storeId } = req.params;
      const { page, limit, skip } = parsePagination(req.query, 10);

      const store = await prisma.retailStore.findUnique({
        where:  { id: storeId },
        select: { id: true, rating: true },
      });
      if (!store) return notFound(res, "Store not found");

      // Use completed visits as review proxy
      const [total, visitStatuses] = await Promise.all([
        prisma.shoppingVisit.count({ where: { storeId, status: "VISITED" } }),
        prisma.shoppingVisit.groupBy({
          by:    ["status"],
          where: { storeId },
          _count: true,
        }),
      ]);

      const statusBreakdown = Object.fromEntries(
        visitStatuses.map((v) => [v.status, v._count])
      );

      const recentVisits = await prisma.shoppingVisit.findMany({
        where:   { storeId, status: "VISITED" },
        orderBy: { actualVisitDate: "desc" },
        skip,
        take:    limit,
        select: {
          id: true, purpose: true, actualVisitDate: true,
          travelPlan: { select: { userId: true } },
        },
      });

      return res.json({
        success: true,
        data: {
          averageRating:  store.rating ?? 0,
          totalCompleted: total,
          statusBreakdown,
          recentVisits,
        },
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ANALYTICS ====================

  /**
   * GET /api/stores/:storeId/analytics
   * BUG FIX: removed `store.totalReviews` references (field does not exist).
   */
  async getStoreAnalytics(req, res, next) {
    try {
      const { storeId } = req.params;

      const allowed = await canManageStore(req.user, storeId, "view");
      if (!allowed) return forbidden(res, "You can only view analytics for your own stores");

      const [store, totalVisits, upcomingVisits, completedVisits, skippedVisits, cancelledVisits] =
        await Promise.all([
          prisma.retailStore.findUnique({
            where:  { id: storeId },
            select: { rating: true, isActive: true, createdAt: true, name: true },
          }),
          prisma.shoppingVisit.count({ where: { storeId } }),
          prisma.shoppingVisit.count({ where: { storeId, status: "PLANNED",   plannedDate: { gt: new Date() } } }),
          prisma.shoppingVisit.count({ where: { storeId, status: "VISITED" } }),
          prisma.shoppingVisit.count({ where: { storeId, status: "SKIPPED" } }),
          prisma.shoppingVisit.count({ where: { storeId, status: "CANCELLED" } }),
        ]);

      if (!store) return notFound(res, "Store not found");

      const monthlyVisits = await prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', planned_date) AS month,
          COUNT(*)::int                     AS count
        FROM shopping_visits
        WHERE store_id = ${storeId}
        GROUP BY DATE_TRUNC('month', planned_date)
        ORDER BY month DESC
        LIMIT 6
      `;

      return res.json({
        success: true,
        data: {
          store: {
            name:      store.name,
            rating:    store.rating,
            isActive:  store.isActive,
            createdAt: store.createdAt,
          },
          stats: {
            totalVisits,
            upcomingVisits,
            completedVisits,
            skippedVisits,
            cancelledVisits,
            conversionRate: totalVisits > 0
              ? +((completedVisits / totalVisits) * 100).toFixed(2)
              : 0,
          },
          trends: monthlyVisits,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN ENDPOINTS ====================

  /**
   * GET /api/admin/stores  [NEW]
   * SuperAdmin — full listing including inactive, with all filters
   */
  async adminGetAllStores(req, res, next) {
    try {
      const {
        vendorId, isActive, isVerified, city, country, storeType,
        search, sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [];
      if (vendorId)           AND.push({ vendorId });
      if (storeType)          AND.push({ storeType });
      if (isActive   !== undefined) AND.push({ isActive:   isActive   === "true" });
      if (isVerified !== undefined) AND.push({ isVerified: isVerified === "true" });
      if (city)    AND.push({ city:    { contains: city,    mode: "insensitive" } });
      if (country) AND.push({ country: { contains: country, mode: "insensitive" } });
      if (search) AND.push({
        OR: [
          { name:        { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });

      const where = AND.length ? { AND } : {};

      const [stores, total] = await Promise.all([
        prisma.retailStore.findMany({
          where,
          include: {
            vendor: { select: { id: true, businessName: true, businessEmail: true } },
            _count: { select: { visits: true } },
          },
          skip,
          take:    limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.retailStore.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       stores,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/stores/:id/verify  [NEW]
   */
  async verifyStore(req, res, next) {
    try {
      const { id } = req.params;
      const { isVerified } = req.body;

      if (typeof isVerified !== "boolean") return badRequest(res, "isVerified must be a boolean");

      const existing = await prisma.retailStore.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const store = await prisma.retailStore.update({
        where:  { id },
        data:   { isVerified },
        select: { id: true, name: true, isVerified: true },
      });

      invalidateStoreCache(id);

      return res.json({
        success: true,
        data:    store,
        message: `Store ${isVerified ? "verified" : "unverified"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/stores/:storeId/visits  [NEW]
   * SuperAdmin — all visits across a store with status/date filters
   */
  async adminGetStoreVisits(req, res, next) {
    try {
      const { storeId } = req.params;
      const { status, from, to } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const existing = await prisma.retailStore.findUnique({ where: { id: storeId }, select: { id: true } });
      if (!existing) return notFound(res, "Store not found");

      const AND = [{ storeId }];
      if (status)   AND.push({ status });
      if (from || to) {
        AND.push({
          plannedDate: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to) }),
          },
        });
      }

      const [visits, total] = await Promise.all([
        prisma.shoppingVisit.findMany({
          where:   { AND },
          include: { travelPlan: { select: { id: true, title: true, userId: true } } },
          orderBy: { plannedDate: "desc" },
          skip,
          take:    limit,
        }),
        prisma.shoppingVisit.count({ where: { AND } }),
      ]);

      return res.json({
        success: true,
        data:       visits,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/shopping-visits/:visitId/status  [NEW]
   * SuperAdmin — force any visit to any status (dispute resolution)
   */
  async adminUpdateVisitStatus(req, res, next) {
    try {
      const { visitId } = req.params;
      const { status, notes } = req.body;

      const visit = await prisma.shoppingVisit.findUnique({
        where:  { id: visitId },
        select: { id: true, travelPlanId: true, storeId: true },
      });
      if (!visit) return notFound(res, "Shopping visit not found");

      const updated = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data: {
          status,
          ...(notes && { aiNotes: notes }),
        },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${visit.travelPlanId}`),
        redisService.client?.del(`store:${visit.storeId}`),
      ]);

      return res.json({
        success: true,
        data:    updated,
        message: `Visit status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StoreController();