"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_CACHE_TTL_S = 3600; // 1 hour
const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 10;

// TransportationStatus enum values
const ACTIVE_BOOKING_STATUSES    = ["BOOKED", "CONFIRMED", "ON_THE_WAY", "ARRIVED", "DELAYED"];
const TERMINAL_BOOKING_STATUSES  = ["COMPLETED", "CANCELLED"];

// Vehicle types that carry a fare premium
const PREMIUM_VEHICLE_TYPES = new Set(["LUXURY", "SUV", "PREMIUM"]);
const PREMIUM_MULTIPLIER = 1.5;

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt", "name", "rating", "baseFare",
]);

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
 * Invalidate both the single-provider cache and the list pattern.
 * Fire-and-forget — never blocks a response.
 */
const invalidateProviderCache = (providerId) =>
  Promise.allSettled([
    redisService.client?.del(`transportation:provider:${providerId}`),
    redisService.deletePattern?.("transportation:providers:list:*"),
  ]);

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns the vendor record (id only) for a user IF the vendor is
 * verified and active.  Returns null otherwise.
 */
const getActiveVendor = (userId) =>
  prisma.vendor.findFirst({
    where:  { userId, verificationStatus: "VERIFIED", isActive: true },
    select: { id: true },
  });

/**
 * Decide whether `user` may manage `providerId`.
 *
 * BUG FIX: original `getMyProviders` queried `vendorId: userId`
 * (User.id vs Vendor.id — different ID spaces). All ownership checks
 * now correctly compare provider.vendorId ↔ vendor.id.
 *
 * BUG FIX: `createProvider` had typo `"veiw"` as action, which always
 * fell through to the `canSellTransportation` OpenFGA check even for
 * the creation guard.  Fixed: creation uses a clean `getActiveVendor` call.
 */
const canManageProvider = async (user, providerId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;
  if (!user?.id) return false;

  if (!providerId) {
    // Creation guard: must be a verified, active vendor
    const vendor = await getActiveVendor(user.id);
    return !!vendor;
  }

  // For existing providers fetch both records concurrently
  const [vendor, provider] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.transportationProvider.findUnique({
      where:  { id: providerId },
      select: { vendorId: true },
    }),
  ]);

  if (!provider) return false;

  // Vendor owns this provider
  if (vendor && provider.vendorId === vendor.id) {
    if (action === "delete") {
      const active = await prisma.transportationBooking.count({
        where: { providerId, status: { in: ACTIVE_BOOKING_STATUSES } },
      });
      return active === 0;
    }
    return true;
  }

  // OpenFGA fallback for team members
  const fgaFns = {
    delete:          openfgaService.canDeleteTransportationProvider,
    update:          openfgaService.canEditTransportationProvider,
    edit:            openfgaService.canEditTransportationProvider,
    view:            openfgaService.canViewTransportationProvider,
    manage_vehicles: openfgaService.canManageProviderVehicles,
    update_avail:    openfgaService.canUpdateProviderAvailability,
  };
  return !!(await fgaFns[action]?.(user.id, providerId).catch(() => false));
};

/**
 * Decide whether `user` may manage a specific vehicle / vehicles on a provider.
 *
 * BUG FIX: original bypassed vendor-ownership check for vehicleId case and
 * jumped straight to OpenFGA.  Now fetches vendor + vehicle's provider
 * concurrently and does ownership check first.
 */
const canManageVehicle = async (user, providerId, vehicleId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;

  // Ownership check first (same pattern as accommodation/service helpers)
  const [vendor, provider] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user?.id }, select: { id: true } }),
    prisma.transportationProvider.findUnique({
      where:  { id: providerId },
      select: { vendorId: true },
    }),
  ]);

  if (vendor && provider?.vendorId === vendor.id) return true;

  if (!vehicleId) {
    return !!(await openfgaService.canManageProviderVehicles?.(user?.id, providerId).catch(() => false));
  }

  const fgaFns = {
    delete: openfgaService.canDeleteTransportationVehicle,
    edit:   openfgaService.canEditTransportationVehicle,
    view:   openfgaService.canViewTransportationVehicle,
  };
  return !!(await fgaFns[action]?.(user?.id, vehicleId).catch(() => false));
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class TransportationController {

  // ==================== PROVIDER MANAGEMENT ====================

  /**
   * POST /api/transportation/providers
   * Create — approved vendors only
   */
  async createProvider(req, res, next) {
    try {
      // BUG FIX: was passing "veiw" (typo) as action
      const canCreate = await canManageProvider(req.user);
      if (!canCreate) return forbidden(res, "Only approved vendors can create transportation providers");

      const vendor = await prisma.vendor.findUnique({
        where:  { userId: req.user.id },
        select: { id: true },
      });
      if (!vendor) return forbidden(res, "Vendor profile not found. Please register as a vendor first.");

      const {
        name, description, providerType, serviceArea, contactNumber, email, website,
        rating, baseFare, perKmRate, perMinuteRate, isAvailable, operatingHours, vehicleTypes,
      } = req.body;

      const provider = await prisma.transportationProvider.create({
        data: {
          vendorId: vendor.id,
          name, providerType,
          serviceArea:   serviceArea   ?? [],
          vehicleTypes:  vehicleTypes  ?? [],
          ...(description    !== undefined && { description }),
          ...(contactNumber  !== undefined && { contactNumber: String(contactNumber) }),
          ...(email          !== undefined && { email }),
          ...(website        !== undefined && { website }),
          ...(rating         !== undefined && { rating }),
          ...(baseFare       !== undefined && { baseFare }),
          ...(perKmRate      !== undefined && { perKmRate }),
          ...(perMinuteRate  !== undefined && { perMinuteRate }),
          ...(isAvailable    !== undefined && { isAvailable }),
          ...(operatingHours !== undefined && { operatingHours }),
        },
        include: { vehicles: true },
      });

      // OpenFGA + cache invalidation (fire-and-forget)
      Promise.allSettled([
        openfgaService.createTransportationProviderRelations(req.user.id, provider.id),
        redisService.deletePattern?.("transportation:providers:list:*"),
      ]);

      return res.status(201).json({
        success: true,
        data: provider,
        message: "Transportation provider created successfully",
      });
    } catch (error) {
      if (error.code === "P2002" && error.meta?.target?.includes("name")) {
        return res.status(409).json({ success: false, message: "Provider with this name already exists" });
      }
      next(error);
    }
  }

  /**
   * GET /api/transportation/providers
   * Public listing — BUG FIX: `location` and `search` both set `where.OR`,
   * so search silently overwrote location filter. Rebuilt with AND[].
   */
  async getAllProviders(req, res, next) {
    try {
      const {
        providerType, city, location, search, minRating, vehicleType,
        sortBy = "rating", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "rating";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [{ isAvailable: true }];

      if (providerType) AND.push({ providerType });

      if (location) {
        AND.push({
          OR: [
            { serviceArea: { has: location } },
            { name:        { contains: location, mode: "insensitive" } },
            { description: { contains: location, mode: "insensitive" } },
          ],
        });
      } else if (city) {
        AND.push({ serviceArea: { has: city } });
      }

      if (minRating)   AND.push({ rating:       { gte: parseFloatParam(minRating, 0) } });
      if (vehicleType) AND.push({ vehicleTypes: { has: vehicleType } });

      // Search is its own AND clause — never overwrites location filter
      if (search) {
        AND.push({
          OR: [
            { name:        { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      const [providers, total] = await Promise.all([
        prisma.transportationProvider.findMany({
          where: { AND },
          include: {
            vehicles: {
              where:  { isAvailable: true },
              take:   5,
              select: { id: true, vehicleType: true, capacity: true, amenities: true, driverRating: true },
            },
            _count: { select: { vehicles: true, bookings: true } },
          },
          skip,
          take: limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.transportationProvider.count({ where: { AND } }),
      ]);

      const data = providers.map((p) => ({
        ...p,
        availableVehicles: p.vehicles.length,
        cheapestOption:    p.baseFare ?? 0,
      }));

      return res.json({
        success: true,
        data,
        pagination: buildPaginationMeta(page, limit, total),
        filters: {
          providerType:  providerType  ?? null,
          location:      location ?? city ?? null,
          minRating:     minRating     ?? null,
          vehicleType:   vehicleType   ?? null,
          search:        search        ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/transportation/providers/:id
   * Public — BUG FIX: original checked `req.user?.id !== provider.vendorId`
   * (User.id vs Vendor.id). Now simply returns 404 for inactive to avoid leaking existence.
   */
  async getProviderById(req, res, next) {
    try {
      const { id } = req.params;
      const skipCache = req.query.skipCache === "true";

      if (!skipCache) {
        const cached = await redisService.client?.get(`transportation:provider:${id}`).catch(() => null);
        if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });
      }

      const provider = await prisma.transportationProvider.findUnique({
        where: { id },
        include: {
          vehicles: { where: { isAvailable: true }, orderBy: { createdAt: "desc" } },
          _count:   { select: { vehicles: true, bookings: true } },
          vendor:   { select: { id: true, businessName: true, businessEmail: true, overallRating: true } },
        },
      });

      if (!provider) return notFound(res, "Transportation provider not found");
      if (!provider.isAvailable && !req.user?.isSuperAdmin) return notFound(res, "Transportation provider not found");

      redisService.client
        ?.setex(`transportation:provider:${id}`, PROVIDER_CACHE_TTL_S, JSON.stringify(provider))
        .catch(() => {});

      return res.json({ success: true, data: provider, cached: false });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/transportation/my-providers
   * Vendor — their own listings including inactive.
   * BUG FIX: original queried `vendorId: userId` (User.id ≠ Vendor.id).
   */
  async getMyProviders(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      // BUG FIX: look up vendor record to get correct vendor.id
      const vendor = await prisma.vendor.findUnique({
        where:  { userId },
        select: { id: true },
      });
      if (!vendor) return notFound(res, "Vendor profile not found");

      const where = {
        vendorId: vendor.id,
        ...(status === "active"   && { isAvailable: true }),
        ...(status === "inactive" && { isAvailable: false }),
      };

      const [providers, total] = await Promise.all([
        prisma.transportationProvider.findMany({
          where,
          include: {
            vehicles: true,
            _count:   { select: { vehicles: true, bookings: true } },
          },
          skip,
          take:     limit,
          orderBy:  { createdAt: "desc" },
        }),
        prisma.transportationProvider.count({ where }),
      ]);

      return res.json({
        success: true,
        data: providers,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/transportation/providers/:id
   * Sparse update — vendorId never writable
   */
  async updateProvider(req, res, next) {
    try {
      const { id } = req.params;

      const allowed = await canManageProvider(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only update your own transportation providers");

      const {
        name, description, providerType, serviceArea, contactNumber, email, website,
        rating, baseFare, perKmRate, perMinuteRate, isAvailable, operatingHours, vehicleTypes,
      } = req.body;

      const provider = await prisma.transportationProvider.update({
        where: { id },
        data: {
          ...(name           !== undefined && { name }),
          ...(description    !== undefined && { description }),
          ...(providerType   !== undefined && { providerType }),
          ...(serviceArea    !== undefined && { serviceArea }),
          ...(contactNumber  !== undefined && { contactNumber: String(contactNumber) }),
          ...(email          !== undefined && { email }),
          ...(website        !== undefined && { website }),
          ...(rating         !== undefined && { rating }),
          ...(baseFare       !== undefined && { baseFare }),
          ...(perKmRate      !== undefined && { perKmRate }),
          ...(perMinuteRate  !== undefined && { perMinuteRate }),
          ...(isAvailable    !== undefined && { isAvailable }),
          ...(operatingHours !== undefined && { operatingHours }),
          ...(vehicleTypes   !== undefined && { vehicleTypes }),
        },
        include: { vehicles: true },
      });

      invalidateProviderCache(id);

      return res.json({ success: true, data: provider, message: "Transportation provider updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Provider not found");
      next(error);
    }
  }

  /**
   * DELETE /api/transportation/providers/:id
   */
  async deleteProvider(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.transportationProvider.findUnique({
        where: { id }, select: { id: true },
      });
      if (!existing) return notFound(res, "Provider not found");

      const allowed = await canManageProvider(req.user, id, "delete");
      if (!allowed) {
        return badRequest(res, "Cannot delete provider with active bookings. Mark it as unavailable instead.");
      }

      await prisma.transportationProvider.delete({ where: { id } });
      invalidateProviderCache(id);

      return res.json({ success: true, message: "Transportation provider deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Provider not found");
      next(error);
    }
  }

  /**
   * PATCH /api/transportation/providers/:id/status  [NEW]
   * Vendor — toggle availability without a full update payload
   */
  async toggleProviderStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { isAvailable } = req.body;

      if (typeof isAvailable !== "boolean") return badRequest(res, "isAvailable must be a boolean");

      const allowed = await canManageProvider(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only manage your own providers");

      const provider = await prisma.transportationProvider.update({
        where:  { id },
        data:   { isAvailable },
        select: { id: true, name: true, isAvailable: true },
      });

      invalidateProviderCache(id);

      return res.json({
        success: true,
        data: provider,
        message: `Provider ${isAvailable ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Provider not found");
      next(error);
    }
  }

  /**
   * GET /api/transportation/providers/:id/stats
   */
  async getProviderStats(req, res, next) {
    try {
      const { id } = req.params;

      const allowed = await canManageProvider(req.user, id, "view");
      if (!allowed) return forbidden(res, "You do not have permission to view these statistics");

      const [
        totalBookings,
        completedBookings,
        cancelledBookings,
        revenueAgg,
        ratingAgg,
        availableVehicleCount,
        totalVehicles,
      ] = await Promise.all([
        prisma.transportationBooking.count({ where: { providerId: id } }),
        prisma.transportationBooking.count({ where: { providerId: id, status: "COMPLETED" } }),
        prisma.transportationBooking.count({ where: { providerId: id, status: "CANCELLED" } }),
        prisma.transportationBooking.aggregate({
          where: { providerId: id, status: "COMPLETED" },
          _sum:  { actualFare: true },
        }),
        prisma.transportationVehicle.aggregate({
          where: { providerId: id },
          _avg:  { driverRating: true },
        }),
        prisma.transportationVehicle.count({ where: { providerId: id, isAvailable: true } }),
        prisma.transportationVehicle.count({ where: { providerId: id } }),
      ]);

      return res.json({
        success: true,
        data: {
          totalBookings,
          completedBookings,
          cancelledBookings,
          activeBookings: totalBookings - completedBookings - cancelledBookings,
          totalRevenue:   revenueAgg._sum.actualFare ?? 0,
          averageRating:  ratingAgg._avg.driverRating ?? 0,
          vehicleUtilization: {
            available:  availableVehicleCount,
            total:      totalVehicles,
            percentage: totalVehicles > 0
              ? +((availableVehicleCount / totalVehicles) * 100).toFixed(2)
              : 0,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/transportation/providers/:providerId/bookings  [NEW]
   * Vendor — view bookings for one of their providers
   */
  async getProviderBookings(req, res, next) {
    try {
      const { providerId } = req.params;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const allowed = await canManageProvider(req.user, providerId, "view");
      if (!allowed) return forbidden(res, "You can only view bookings for your own providers");

      const where = {
        providerId,
        ...(status && { status }),
      };

      const [bookings, total] = await Promise.all([
        prisma.transportationBooking.findMany({
          where,
          include: {
            vehicle:    { select: { id: true, vehicleNumber: true, vehicleType: true } },
            travelPlan: { select: { id: true, title: true, userId: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.transportationBooking.count({ where }),
      ]);

      return res.json({
        success: true,
        data: bookings,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== VEHICLE MANAGEMENT ====================

  /**
   * POST /api/transportation/providers/:providerId/vehicles
   */
  async addVehicle(req, res, next) {
    try {
      const { providerId } = req.params;

      const allowed = await canManageVehicle(req.user, providerId, null, "edit");
      if (!allowed) return forbidden(res, "You can only add vehicles to your own providers");

      const {
        vehicleNumber, vehicleType, make, model, year, color,
        capacity, amenities, driverName, driverContact, driverRating, isAvailable,
      } = req.body;

      const vehicle = await prisma.transportationVehicle.create({
        data: {
          providerId,
          vehicleNumber,
          vehicleType,
          ...(make          !== undefined && { make }),
          ...(model         !== undefined && { model }),
          ...(year          !== undefined && { year }),
          ...(color         !== undefined && { color }),
          capacity:         capacity  ?? 4,
          amenities:        amenities ?? [],
          ...(driverName    !== undefined && { driverName }),
          ...(driverContact !== undefined && { driverContact: String(driverContact) }),
          ...(driverRating  !== undefined && { driverRating }),
          isAvailable:      isAvailable ?? true,
        },
      });

      Promise.allSettled([
        openfgaService.createTransportationVehicleRelations(req.user.id, vehicle.id, providerId),
        redisService.client?.del(`transportation:provider:${providerId}`),
      ]);

      return res.status(201).json({ success: true, data: vehicle, message: "Vehicle added successfully" });
    } catch (error) {
      if (error.code === "P2002" && error.meta?.target?.includes("vehicleNumber")) {
        return res.status(409).json({ success: false, message: "Vehicle with this number already exists" });
      }
      next(error);
    }
  }

  /**
   * POST /api/transportation/providers/:providerId/vehicles/bulk  [NEW — improved]
   * Bulk add with createMany for a single DB round-trip, then batch OpenFGA
   */
  async bulkAddVehicles(req, res, next) {
    try {
      const { providerId } = req.params;
      const { vehicles } = req.body;

      if (!Array.isArray(vehicles) || vehicles.length === 0) {
        return badRequest(res, "vehicles must be a non-empty array");
      }

      const allowed = await canManageVehicle(req.user, providerId, null, "edit");
      if (!allowed) return forbidden(res, "You can only add vehicles to your own providers");

      // Verify the provider exists
      const providerExists = await prisma.transportationProvider.findUnique({
        where: { id: providerId }, select: { id: true },
      });
      if (!providerExists) return notFound(res, "Provider not found");

      const vehiclesData = vehicles.map((v) => ({
        ...v,
        providerId,
        amenities:     v.amenities     ?? [],
        capacity:      v.capacity      ?? 4,
        isAvailable:   v.isAvailable   ?? true,
        driverContact: v.driverContact ? String(v.driverContact) : null,
      }));

      // Use createMany for a single batch INSERT instead of N separate inserts
      await prisma.transportationVehicle.createMany({ data: vehiclesData, skipDuplicates: true });

      // Fetch the newly created vehicles to return them and set up OpenFGA
      const created = await prisma.transportationVehicle.findMany({
        where: {
          providerId,
          vehicleNumber: { in: vehiclesData.map((v) => v.vehicleNumber) },
        },
      });

      Promise.allSettled([
        ...created.map((v) =>
          openfgaService.createTransportationVehicleRelations(req.user.id, v.id, providerId)
        ),
        redisService.client?.del(`transportation:provider:${providerId}`),
      ]);

      return res.status(201).json({
        success: true,
        data: created,
        message: `${created.length} vehicle(s) added successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/transportation/vehicles/:vehicleId
   * Sparse update
   */
  async updateVehicle(req, res, next) {
    try {
      const { vehicleId } = req.params;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where:  { id: vehicleId },
        select: { provider: { select: { id: true } } },
      });
      if (!vehicle) return notFound(res, "Vehicle not found");

      const allowed = await canManageVehicle(req.user, vehicle.provider.id, vehicleId, "edit");
      if (!allowed) return forbidden(res, "You can only update vehicles in your own providers");

      const {
        vehicleNumber, vehicleType, make, model, year, color,
        capacity, amenities, driverName, driverContact, driverRating, isAvailable,
      } = req.body;

      const updated = await prisma.transportationVehicle.update({
        where: { id: vehicleId },
        data: {
          ...(vehicleNumber !== undefined && { vehicleNumber }),
          ...(vehicleType   !== undefined && { vehicleType }),
          ...(make          !== undefined && { make }),
          ...(model         !== undefined && { model }),
          ...(year          !== undefined && { year }),
          ...(color         !== undefined && { color }),
          ...(capacity      !== undefined && { capacity }),
          ...(amenities     !== undefined && { amenities }),
          ...(driverName    !== undefined && { driverName }),
          ...(driverContact !== undefined && { driverContact: String(driverContact) }),
          ...(driverRating  !== undefined && { driverRating }),
          ...(isAvailable   !== undefined && { isAvailable }),
        },
      });

      redisService.client?.del(`transportation:provider:${vehicle.provider.id}`).catch(() => {});

      return res.json({ success: true, data: updated, message: "Vehicle updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Vehicle not found");
      next(error);
    }
  }

  /**
   * PATCH /api/transportation/vehicles/:vehicleId/location
   * BUG FIX: original compared `req.user.id !== vehicle.driverName` — a User
   * ID vs a name string. Removed the unreliable driver check; location updates
   * now require canManageVehicle (vendor/team-member ownership via OpenFGA).
   */
  async updateVehicleLocation(req, res, next) {
    try {
      const { vehicleId } = req.params;
      const { lat, lng } = req.body;

      if (typeof lat !== "number" || typeof lng !== "number") {
        return badRequest(res, "lat and lng must be numbers");
      }

      const vehicle = await prisma.transportationVehicle.findUnique({
        where:  { id: vehicleId },
        select: { provider: { select: { id: true } } },
      });
      if (!vehicle) return notFound(res, "Vehicle not found");

      const allowed = await canManageVehicle(req.user, vehicle.provider.id, vehicleId, "edit");
      if (!allowed) return forbidden(res, "You do not have permission to update this vehicle's location");

      const updated = await prisma.transportationVehicle.update({
        where:  { id: vehicleId },
        data:   { currentLocation: { lat, lng, timestamp: new Date().toISOString() } },
        select: { id: true, currentLocation: true },
      });

      return res.json({ success: true, data: updated.currentLocation, message: "Vehicle location updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/transportation/vehicles/:vehicleId
   */
  async deleteVehicle(req, res, next) {
    try {
      const { vehicleId } = req.params;

      const vehicle = await prisma.transportationVehicle.findUnique({
        where:  { id: vehicleId },
        select: { provider: { select: { id: true } } },
      });
      if (!vehicle) return notFound(res, "Vehicle not found");

      const allowed = await canManageVehicle(req.user, vehicle.provider.id, vehicleId, "delete");
      if (!allowed) return forbidden(res, "You can only delete vehicles in your own providers");

      // Check future bookings via relation (not via include on the initial fetch)
      const futureBookings = await prisma.transportationBooking.count({
        where: {
          vehicleId,
          pickupTime: { gt: new Date() },
          status:     { in: ["BOOKED", "CONFIRMED"] },
        },
      });

      if (futureBookings > 0) {
        return badRequest(res, "Cannot delete vehicle with future bookings. Mark it as unavailable instead.");
      }

      await prisma.transportationVehicle.delete({ where: { id: vehicleId } });
      redisService.client?.del(`transportation:provider:${vehicle.provider.id}`).catch(() => {});

      return res.json({ success: true, message: "Vehicle deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Vehicle not found");
      next(error);
    }
  }

  /**
   * PATCH /api/transportation/providers/:providerId/vehicles/availability  [NEW]
   * Bulk-toggle availability for multiple vehicles in one round-trip
   */
  async bulkUpdateVehicleAvailability(req, res, next) {
    try {
      const { providerId } = req.params;
      const { vehicleIds, isAvailable } = req.body;

      if (!Array.isArray(vehicleIds) || vehicleIds.length === 0) {
        return badRequest(res, "vehicleIds must be a non-empty array");
      }
      if (typeof isAvailable !== "boolean") {
        return badRequest(res, "isAvailable must be a boolean");
      }

      const allowed = await canManageVehicle(req.user, providerId, null, "edit");
      if (!allowed) return forbidden(res, "You can only manage vehicles in your own providers");

      // Ownership verification — all IDs must belong to this provider
      const ownedCount = await prisma.transportationVehicle.count({
        where: { id: { in: vehicleIds }, providerId },
      });
      if (ownedCount !== vehicleIds.length) {
        return badRequest(res, "One or more vehicle IDs do not belong to this provider");
      }

      const { count } = await prisma.transportationVehicle.updateMany({
        where: { id: { in: vehicleIds }, providerId },
        data:  { isAvailable },
      });

      redisService.client?.del(`transportation:provider:${providerId}`).catch(() => {});

      return res.json({
        success: true,
        updatedCount: count,
        message: `${count} vehicle(s) ${isAvailable ? "marked available" : "marked unavailable"}`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/transportation/vehicles/:vehicleId/history
   */
  async getVehicleHistory(req, res, next) {
    try {
      const { vehicleId } = req.params;
      const { from, to } = req.query;
      const { limit } = parsePagination(req.query, 50);

      const vehicle = await prisma.transportationVehicle.findUnique({
        where:  { id: vehicleId },
        select: { provider: { select: { id: true } } },
      });
      if (!vehicle) return notFound(res, "Vehicle not found");

      const allowed = await canManageVehicle(req.user, vehicle.provider.id, vehicleId, "view");
      if (!allowed) return forbidden(res, "You do not have permission to view this vehicle's history");

      const where = {
        vehicleId,
        ...(from || to) && {
          pickupTime: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to)   }),
          },
        },
      };

      const bookings = await prisma.transportationBooking.findMany({
        where,
        orderBy: { pickupTime: "desc" },
        take:    limit,
        include: { travelPlan: { select: { id: true, title: true } } },
      });

      return res.json({ success: true, data: bookings, total: bookings.length });
    } catch (error) {
      next(error);
    }
  }

  // ==================== AVAILABILITY & FARE ====================

  /**
   * GET /api/transportation/providers/:providerId/available-vehicles
   * Public — uses proper date-overlap logic and Set for O(1) lookup
   */
  async getAvailableVehicles(req, res, next) {
    try {
      const { providerId } = req.params;
      const { pickupTime, dropoffTime, passengers, vehicleType } = req.query;

      if (!pickupTime || !dropoffTime) {
        return badRequest(res, "Pickup and dropoff times are required");
      }

      const pickup  = new Date(pickupTime);
      const dropoff = new Date(dropoffTime);

      if (isNaN(pickup.getTime()) || isNaN(dropoff.getTime())) {
        return badRequest(res, "Invalid date format");
      }
      if (dropoff <= pickup) return badRequest(res, "Dropoff time must be after pickup time");

      const passengerCount = parseIntParam(passengers, 1);

      const [allVehicles, bookedBookings] = await Promise.all([
        prisma.transportationVehicle.findMany({
          where: {
            providerId,
            isAvailable: true,
            capacity:    { gte: passengerCount },
            ...(vehicleType && { vehicleType }),
          },
        }),
        prisma.transportationBooking.findMany({
          where: {
            providerId,
            status:   { in: ACTIVE_BOOKING_STATUSES },
            vehicleId: { not: null },
            AND: [
              { pickupTime:       { lt: dropoff } },
              { estimatedArrival: { gt: pickup  } },
            ],
          },
          select: { vehicleId: true },
        }),
      ]);

      const bookedIds = new Set(bookedBookings.map((b) => b.vehicleId).filter(Boolean));
      const availableVehicles = allVehicles.filter((v) => !bookedIds.has(v.id));

      // Fetch fare info separately (not on the hot path for large fleets)
      const provider = await prisma.transportationProvider.findUnique({
        where:  { id: providerId },
        select: { baseFare: true, perKmRate: true, perMinuteRate: true },
      });

      return res.json({
        success: true,
        data:           availableVehicles,
        totalAvailable: availableVehicles.length,
        totalVehicles:  allVehicles.length,
        fareInfo: {
          baseFare:      provider?.baseFare     ?? null,
          perKmRate:     provider?.perKmRate    ?? null,
          perMinuteRate: provider?.perMinuteRate ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/transportation/calculate-fare
   * Improved: fare breakdown computed without mutating `estimatedFare` mid-way
   */
  async calculateFare(req, res, next) {
    try {
      const { providerId, distance, duration, vehicleType } = req.body;

      const provider = await prisma.transportationProvider.findUnique({
        where:  { id: providerId },
        select: { baseFare: true, perKmRate: true, perMinuteRate: true },
      });
      if (!provider) return notFound(res, "Provider not found");

      const baseFare       = provider.baseFare     ?? 0;
      const distanceCharge = (distance && provider.perKmRate)     ? distance * provider.perKmRate     : 0;
      const timeCharge     = (duration && provider.perMinuteRate) ? duration * provider.perMinuteRate : 0;
      const subtotal       = baseFare + distanceCharge + timeCharge;

      const isPremium     = vehicleType && PREMIUM_VEHICLE_TYPES.has(vehicleType.toUpperCase());
      const multiplier    = isPremium ? PREMIUM_MULTIPLIER : 1.0;
      const premiumCharge = isPremium ? subtotal * (PREMIUM_MULTIPLIER - 1) : 0;
      const estimatedFare = +(subtotal * multiplier).toFixed(2);

      return res.json({
        success: true,
        data: {
          estimatedFare,
          currency: "USD",
          breakdown: {
            baseFare,
            distanceCharge: +distanceCharge.toFixed(2),
            timeCharge:     +timeCharge.toFixed(2),
            premiumCharge:  +premiumCharge.toFixed(2),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== BOOKING MANAGEMENT ====================

  /**
   * POST /api/travel-plans/:travelPlanId/transportation-bookings
   * SCHEMA FIX: Booking uses `snapshotVehicle*` fields, not mutable vehicle fields.
   * Snapshot values are stamped at booking time from the current vehicle record.
   */
  async createBooking(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const {
        providerId, vehicleId, serviceType,
        pickupLocation, dropoffLocation, pickupTime, estimatedArrival,
        numberOfPassengers, specialRequests,
        estimatedFare, paymentMethod,
      } = req.body;

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelPlan?.(req.user.id, travelPlanId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      const pickup   = new Date(pickupTime);
      const arrival  = estimatedArrival ? new Date(estimatedArrival) : null;

      if (isNaN(pickup.getTime())) return badRequest(res, "Invalid pickup time");
      if (arrival && arrival <= pickup) return badRequest(res, "Estimated arrival must be after pickup time");

      // Validate provider and vehicle concurrently
      const [provider, vehicle] = await Promise.all([
        providerId ? prisma.transportationProvider.findUnique({
          where:  { id: providerId },
          select: { id: true, isAvailable: true },
        }) : null,
        vehicleId ? prisma.transportationVehicle.findUnique({
          where:  { id: vehicleId },
          select: { id: true, isAvailable: true, vehicleType: true, vehicleNumber: true, driverName: true, driverContact: true },
        }) : null,
      ]);

      if (providerId && !provider) return notFound(res, "Transportation provider not found");
      if (provider && !provider.isAvailable) return badRequest(res, "Provider is not currently available");

      if (vehicleId) {
        if (!vehicle) return notFound(res, "Vehicle not found");
        if (!vehicle.isAvailable) return badRequest(res, "Vehicle is not currently available");

        // Time-overlap conflict check
        const conflictCount = await prisma.transportationBooking.count({
          where: {
            vehicleId,
            status: { in: ACTIVE_BOOKING_STATUSES },
            AND: [
              { pickupTime:       { lt: arrival ?? pickup } },
              { estimatedArrival: { gt: pickup } },
            ],
          },
        });

        if (conflictCount > 0) {
          return res.status(409).json({ success: false, message: "Vehicle is not available for the selected time slot" });
        }
      }

      const booking = await prisma.transportationBooking.create({
        data: {
          travelPlanId,
          ...(providerId          !== undefined && { providerId }),
          ...(vehicleId           !== undefined && { vehicleId }),
          serviceType,
          pickupLocation,
          dropoffLocation,
          pickupTime:             pickup,
          ...(arrival             && { estimatedArrival: arrival }),
          numberOfPassengers:     numberOfPassengers ?? 1,
          ...(specialRequests     !== undefined && { specialRequests }),
          ...(estimatedFare       !== undefined && { estimatedFare }),
          ...(paymentMethod       !== undefined && { paymentMethod }),
          // Stamp snapshot fields from live vehicle record at booking time
          ...(vehicle && {
            snapshotVehicleType:    vehicle.vehicleType,
            snapshotVehicleNumber:  vehicle.vehicleNumber,
            snapshotDriverName:     vehicle.driverName,
            snapshotDriverContact:  vehicle.driverContact,
          }),
        },
        include: { provider: true, vehicle: true },
      });

      Promise.allSettled([
        openfgaService.createTransportationBookingRelations(req.user.id, booking.id, travelPlanId),
        redisService.client?.del(`travelplan:${travelPlanId}`),
        providerId && redisService.client?.del(`transportation:provider:${providerId}`),
      ]);

      return res.status(201).json({
        success: true,
        data: booking,
        message: "Transportation booking created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/transportation/bookings/:bookingId
   * FIX: existence check before permission check
   */
  async getBookingById(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where: { id: bookingId },
        include: {
          provider:   true,
          vehicle:    true,
          travelPlan: { select: { id: true, title: true, userId: true } },
        },
      });

      if (!booking) return notFound(res, "Booking not found");

      const canView =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canViewTransportationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canView) return forbidden(res, "You do not have permission to view this booking");

      return res.json({ success: true, data: booking });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/transportation/bookings/:bookingId
   * FIX: existence check before permission check; sparse update replaces `req.body` pass-through
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, travelPlanId: true, providerId: true },
      });

      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_BOOKING_STATUSES.includes(booking.status)) {
        return badRequest(res, `Cannot update booking with status: ${booking.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTransportationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        pickupLocation, dropoffLocation, pickupTime, estimatedArrival,
        numberOfPassengers, specialRequests, status, paymentMethod, paymentStatus,
      } = req.body;

      const updated = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: {
          ...(pickupLocation     !== undefined && { pickupLocation }),
          ...(dropoffLocation    !== undefined && { dropoffLocation }),
          ...(pickupTime         !== undefined && { pickupTime:       new Date(pickupTime) }),
          ...(estimatedArrival   !== undefined && { estimatedArrival: new Date(estimatedArrival) }),
          ...(numberOfPassengers !== undefined && { numberOfPassengers }),
          ...(specialRequests    !== undefined && { specialRequests }),
          ...(status             !== undefined && { status }),
          ...(paymentMethod      !== undefined && { paymentMethod }),
          ...(paymentStatus      !== undefined && { paymentStatus }),
        },
        include: { provider: true, vehicle: true },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        booking.providerId && redisService.client?.del(`transportation:provider:${booking.providerId}`),
      ]);

      return res.json({ success: true, data: updated, message: "Booking updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/transportation/bookings/:bookingId
   * BUG FIX: original set `isPaid: false` — no such field on TransportationBooking schema.
   * Removed. Also added already-cancelled guard.
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, paymentStatus: true, travelPlanId: true, providerId: true },
      });

      if (!booking) return notFound(res, "Booking not found");
      if (booking.status === "CANCELLED") return badRequest(res, "Booking is already cancelled");
      if (booking.status === "COMPLETED") return badRequest(res, "Cannot cancel a completed booking");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelTransportationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this booking");

      const cancelled = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: {
          status:        "CANCELLED",
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus,
        },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        booking.providerId && redisService.client?.del(`transportation:provider:${booking.providerId}`),
      ]);

      return res.json({ success: true, data: cancelled, message: "Booking cancelled successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN ENDPOINTS ====================

  /**
   * GET /api/admin/transportation/providers  [NEW]
   * SuperAdmin — full listing with vendor/status/feature filters
   */
  async adminGetAllProviders(req, res, next) {
    try {
      const {
        vendorId, isAvailable, isVerified, isFeatured,
        providerType, search, sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [];
      if (vendorId)      AND.push({ vendorId });
      if (providerType)  AND.push({ providerType });
      if (isAvailable !== undefined) AND.push({ isAvailable: isAvailable === "true" });
      if (isVerified  !== undefined) AND.push({ isVerified:  isVerified  === "true" });
      if (isFeatured  !== undefined) AND.push({ isFeatured:  isFeatured  === "true" });
      if (search) AND.push({
        OR: [
          { name:        { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });

      const where = AND.length ? { AND } : {};

      const [providers, total] = await Promise.all([
        prisma.transportationProvider.findMany({
          where,
          include: {
            vendor: { select: { id: true, businessName: true, businessEmail: true } },
            _count: { select: { vehicles: true, bookings: true } },
          },
          skip,
          take:     limit,
          orderBy:  { [safeSortBy]: safeSortOrder },
        }),
        prisma.transportationProvider.count({ where }),
      ]);

      return res.json({
        success: true,
        data: providers,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/transportation/providers/:id/verify  [NEW]
   */
  async verifyProvider(req, res, next) {
    try {
      const { id } = req.params;
      const { isVerified } = req.body;

      if (typeof isVerified !== "boolean") return badRequest(res, "isVerified must be a boolean");

      const existing = await prisma.transportationProvider.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Provider not found");

      const provider = await prisma.transportationProvider.update({
        where:  { id },
        data:   { isVerified },
        select: { id: true, name: true, isVerified: true },
      });

      invalidateProviderCache(id);

      return res.json({
        success: true,
        data: provider,
        message: `Provider ${isVerified ? "verified" : "unverified"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/transportation/providers/:id/feature  [NEW]
   */
  async featureProvider(req, res, next) {
    try {
      const { id } = req.params;
      const { isFeatured, featuredUntil } = req.body;

      if (typeof isFeatured !== "boolean") return badRequest(res, "isFeatured must be a boolean");

      const existing = await prisma.transportationProvider.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Provider not found");

      const provider = await prisma.transportationProvider.update({
        where:  { id },
        data: {
          isFeatured,
          featuredUntil: isFeatured && featuredUntil ? new Date(featuredUntil) : null,
        },
        select: { id: true, name: true, isFeatured: true, featuredUntil: true },
      });

      invalidateProviderCache(id);

      return res.json({
        success: true,
        data: provider,
        message: `Provider ${isFeatured ? "featured" : "unfeatured"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/transportation/bookings  [NEW]
   * SuperAdmin — all bookings with date/status/provider filters
   */
  async adminGetAllBookings(req, res, next) {
    try {
      const { status, providerId, vehicleId, from, to } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const AND = [];
      if (status)     AND.push({ status });
      if (providerId) AND.push({ providerId });
      if (vehicleId)  AND.push({ vehicleId });
      if (from || to) {
        AND.push({
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to) }),
          },
        });
      }

      const where = AND.length ? { AND } : {};

      const [bookings, total] = await Promise.all([
        prisma.transportationBooking.findMany({
          where,
          include: {
            provider:   { select: { id: true, name: true } },
            vehicle:    { select: { id: true, vehicleNumber: true, vehicleType: true } },
            travelPlan: { select: { id: true, title: true, userId: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.transportationBooking.count({ where }),
      ]);

      return res.json({
        success: true,
        data: bookings,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/transportation/bookings/:bookingId/status  [NEW]
   * SuperAdmin — force any booking status (dispute resolution, ops override)
   */
  async adminUpdateBookingStatus(req, res, next) {
    try {
      const { bookingId } = req.params;
      const { status, notes } = req.body;

      const booking = await prisma.transportationBooking.findUnique({
        where:  { id: bookingId },
        select: { id: true, travelPlanId: true, providerId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      const updated = await prisma.transportationBooking.update({
        where: { id: bookingId },
        data: {
          status,
          ...(notes && { aiNotes: notes }),
        },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        booking.providerId && redisService.client?.del(`transportation:provider:${booking.providerId}`),
      ]);

      return res.json({
        success: true,
        data: updated,
        message: `Booking status updated to ${status}`,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TransportationController();