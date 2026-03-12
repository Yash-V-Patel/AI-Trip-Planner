"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOMMODATION_CACHE_TTL_S = 3600; // 1 hour
const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 10;

// BookingStatus enum values used for grouping
const ACTIVE_BOOKING_STATUSES   = ["PENDING", "CONFIRMED", "CHECKED_IN"];
const TERMINAL_BOOKING_STATUSES = ["CANCELLED", "CHECKED_OUT", "NO_SHOW"];

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt", "name", "starRating", "overallRating", "city",
]);

// PriceCategory enum: BUDGET | MIDRANGE | LUXURY | BOUTIQUE
// FIX: original returned "EXPENSIVE" which does not exist in the enum
const PRICE_CATEGORY_THRESHOLDS = [
  { max: 3000,  category: "BUDGET"   },
  { max: 7000,  category: "MIDRANGE" },
  { max: 15000, category: "LUXURY"   },
];

// ---------------------------------------------------------------------------
// Module-level helpers (mirrors vendor controller pattern)
// ---------------------------------------------------------------------------

const notFound   = (res, msg = "Resource not found") => res.status(404).json({ success: false, message: msg });
const forbidden  = (res, msg = "Unauthorized access") => res.status(403).json({ success: false, message: msg });
const badRequest = (res, msg) => res.status(400).json({ success: false, message: msg });

const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parsePagination = (query, defaultLimit = DEFAULT_LIMIT) => {
  const page  = parseIntParam(query.page,  DEFAULT_PAGE);
  const limit = parseIntParam(query.limit, defaultLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const buildPaginationMeta = (page, limit, total) => ({
  page, limit, total, pages: Math.ceil(total / limit),
});

/** Map a numeric max-price to the correct PriceCategory enum value. */
const getPriceCategoryFromMax = (maxPrice) => {
  for (const { max, category } of PRICE_CATEGORY_THRESHOLDS) {
    if (maxPrice < max) return category;
  }
  return "BOUTIQUE";
};

/**
 * Invalidate both the single-accommodation cache entry and the list cache pattern.
 * Fire-and-forget — never blocks a response.
 */
const invalidateAccommodationCache = (accommodationId) =>
  Promise.allSettled([
    redisService.client?.del(`accommodation:${accommodationId}`),
    // FIX: Redis `del` does not support globs; use deletePattern for wildcard invalidation
    redisService.deletePattern?.("accommodations:list:*"),
  ]);

// ---------------------------------------------------------------------------
// Permission helpers (extracted from class — no `this` needed, easier to test)
// ---------------------------------------------------------------------------

/**
 * Returns the vendor record (id only) for a user IF the vendor is verified and active.
 * Returns null otherwise.
 */
const getActiveVendor = (userId) =>
  prisma.vendor.findFirst({
    where:  { userId, verificationStatus: "VERIFIED", isActive: true },
    select: { id: true },
  });

/**
 * Decide whether `user` may manage `accommodationId`.
 *
 * - SuperAdmin   → always yes
 * - No id given  → creation guard: must be an approved vendor
 * - id given     → ownership check, then OpenFGA team-member fallback
 *
 * BUG FIX (canManageAccommodation): original `canManageRoom` compared
 * `accommodation.vendorId` (Vendor.id) to `user.id` (User.id) — different
 * ID spaces. Fixed: both helpers now fetch the vendor record first.
 */
const canManageAccommodation = async (user, accommodationId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;

  if (!accommodationId) {
    // For creation: user must be an active, verified vendor
    const vendor = await getActiveVendor(user?.id);
    return !!vendor;
  }

  const [vendor, accommodation] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user?.id }, select: { id: true } }),
    prisma.accommodation.findUnique({ where: { id: accommodationId }, select: { vendorId: true } }),
  ]);

  if (!accommodation) return false;

  // Vendor owns this accommodation
  if (vendor && accommodation.vendorId === vendor.id) {
    if (action === "delete") {
      const activeCount = await prisma.accommodationBooking.count({
        where: { accommodationId, bookingStatus: { in: ACTIVE_BOOKING_STATUSES } },
      });
      return activeCount === 0;
    }
    return true;
  }

  // OpenFGA fallback (team-member access, etc.)
  const fgaFns = {
    delete: openfgaService.canDeleteAccommodation,
    update: openfgaService.canEditAccommodation,
    edit:   openfgaService.canEditAccommodation,
    view:   openfgaService.canViewAccommodation,
  };
  return !!(await fgaFns[action]?.(user?.id, accommodationId).catch(() => false));
};

/** Same ownership-bug fix applied to room management. */
const canManageRoom = async (user, accommodationId, roomId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;

  const [vendor, accommodation] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user?.id }, select: { id: true } }),
    prisma.accommodation.findUnique({ where: { id: accommodationId }, select: { vendorId: true } }),
  ]);

  // FIX: compare vendor.id ↔ accommodation.vendorId, NOT user.id ↔ accommodation.vendorId
  if (vendor && accommodation?.vendorId === vendor.id) return true;

  if (!roomId) {
    return !!(await openfgaService.canManageAccommodationRooms?.(user?.id, accommodationId).catch(() => false));
  }

  const fgaFns = {
    delete: openfgaService.canDeleteRoom,
    edit:   openfgaService.canEditRoom,
    view:   openfgaService.canViewRoom,
  };
  return !!(await fgaFns[action]?.(user?.id, roomId).catch(() => false));
};

/** Same ownership-bug fix applied to service management. */
const canManageService = async (user, accommodationId, serviceId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;

  const [vendor, accommodation] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user?.id }, select: { id: true } }),
    prisma.accommodation.findUnique({ where: { id: accommodationId }, select: { vendorId: true } }),
  ]);

  if (vendor && accommodation?.vendorId === vendor.id) return true;

  if (!serviceId) {
    return !!(await openfgaService.canManageAccommodationServices?.(user?.id, accommodationId).catch(() => false));
  }

  const fgaFns = {
    delete: openfgaService.canDeleteService,
    edit:   openfgaService.canEditService,
    view:   openfgaService.canViewService,
  };
  return !!(await fgaFns[action]?.(user?.id, serviceId).catch(() => false));
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class AccommodationController {

  // ==================== ACCOMMODATION MANAGEMENT ====================

  /**
   * POST /api/accommodations
   * Create — approved vendors only
   */
  async createAccommodation(req, res, next) {
    try {
      const canCreate = await canManageAccommodation(req.user);
      if (!canCreate) return forbidden(res, "Only approved vendors can create accommodations");

      const vendor = await prisma.vendor.findUnique({
        where:  { userId: req.user.id },
        select: { id: true },
      });

      if (!vendor) return forbidden(res, "Vendor record not found");

      const {
        name, description, address, city, country, latitude, longitude,
        phone, email, website, starRating, accommodationType, priceCategory,
        amenities, images, checkInTime, checkOutTime, policies, cancellationPolicy,
      } = req.body;

      // Sparse create — only include explicitly provided fields
      const accommodation = await prisma.accommodation.create({
        data: {
          vendorId: vendor.id,
          name, description, address, city, country,
          ...(latitude          !== undefined && { latitude }),
          ...(longitude         !== undefined && { longitude }),
          ...(phone             !== undefined && { phone: String(phone) }),
          ...(email             !== undefined && { email }),
          ...(website           !== undefined && { website }),
          ...(starRating        !== undefined && { starRating }),
          ...(accommodationType !== undefined && { accommodationType }),
          ...(priceCategory     !== undefined && { priceCategory }),
          amenities:          amenities  ?? [],
          images:             images     ?? [],
          ...(checkInTime       !== undefined && { checkInTime }),
          ...(checkOutTime      !== undefined && { checkOutTime }),
          ...(policies          !== undefined && { policies }),
          ...(cancellationPolicy !== undefined && { cancellationPolicy }),
        },
        include: { rooms: true, services: true },
      });

      // OpenFGA + list-cache invalidation (fire-and-forget)
      Promise.allSettled([
        openfgaService.createAccommodationRelations(req.user.id, accommodation.id),
        redisService.deletePattern?.("accommodations:list:*"),
      ]);

      return res.status(201).json({
        success: true,
        data: accommodation,
        message: "Accommodation created successfully",
      });
    } catch (error) {
      if (error.code === "P2002" && error.meta?.target?.includes("name")) {
        return res.status(409).json({ success: false, message: "Accommodation with this name already exists" });
      }
      next(error);
    }
  }

  /**
   * GET /api/accommodations
   * Public listing with filtering, search, pagination, and sort whitelisting
   *
   * FIX: `location` and `search` both previously set `where.OR`, so search
   *      silently overwrote location. Rebuilt using an AND[] array.
   */
  async getAllAccommodations(req, res, next) {
    try {
      const {
        location, city, country, type, minRating, maxPrice, search,
        sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      // Build all conditions as AND clauses to prevent any OR overwrite
      const AND = [{ isActive: true }];

      if (location) {
        AND.push({
          OR: [
            { city:    { contains: location, mode: "insensitive" } },
            { address: { contains: location, mode: "insensitive" } },
            { name:    { contains: location, mode: "insensitive" } },
          ],
        });
      } else {
        if (city)    AND.push({ city:    { contains: city,    mode: "insensitive" } });
        if (country) AND.push({ country: { contains: country, mode: "insensitive" } });
      }

      if (type)      AND.push({ accommodationType: type });
      if (minRating) AND.push({ starRating: { gte: parseIntParam(minRating, 1) } });
      if (maxPrice)  AND.push({ priceCategory: getPriceCategoryFromMax(parseIntParam(maxPrice, 0)) });

      // Keyword search is its own AND clause — never overwrites location filter
      if (search) {
        AND.push({
          OR: [
            { name:        { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        });
      }

      const [accommodations, total] = await Promise.all([
        prisma.accommodation.findMany({
          where: { AND },
          include: {
            rooms: {
              where: { isAvailable: true },
              take: 3,
              select: {
                id: true, roomNumber: true, roomType: true,
                basePrice: true, maxOccupancy: true, isAvailable: true,
              },
            },
            _count: { select: { rooms: true, bookings: true } },
          },
          skip,
          take: limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.accommodation.count({ where: { AND } }),
      ]);

      const data = accommodations.map((acc) => ({
        ...acc,
        availableRooms: acc.rooms.length,
        cheapestRoom:   acc.rooms.length > 0 ? Math.min(...acc.rooms.map((r) => r.basePrice)) : null,
        roomTypes:      [...new Set(acc.rooms.map((r) => r.roomType))],
      }));

      return res.json({
        success: true,
        data,
        pagination: buildPaginationMeta(page, limit, total),
        filters: {
          location: location ?? null,
          city:     city     ?? null,
          country:  country  ?? null,
          type:     type     ?? null,
          minRating: minRating ?? null,
          maxPrice:  maxPrice  ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/accommodations/:id
   * Public — returns accommodation with active rooms, services, and vendor summary
   * FIX: inactive accommodation now returns 404 instead of 403 (don't leak existence)
   */
  async getAccommodationById(req, res, next) {
    try {
      const { id } = req.params;
      const skipCache = req.query.skipCache === "true";

      if (!skipCache) {
        const cached = await redisService.client?.get(`accommodation:${id}`).catch(() => null);
        if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });
      }

      const accommodation = await prisma.accommodation.findUnique({
        where: { id },
        include: {
          rooms:    { where: { isAvailable: true }, orderBy: { basePrice: "asc" } },
          services: { where: { isAvailable: true } },
          vendor: {
            select: { id: true, businessName: true, overallRating: true, businessEmail: true },
          },
        },
      });

      if (!accommodation || !accommodation.isActive) return notFound(res, "Accommodation not found");

      // Fire-and-forget cache write
      redisService.client
        ?.setex(`accommodation:${id}`, ACCOMMODATION_CACHE_TTL_S, JSON.stringify(accommodation))
        .catch(() => {});

      return res.json({ success: true, data: accommodation, cached: false });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/accommodations/:id
   * Vendor (own) / SuperAdmin — sparse update, vendorId is never writable
   */
  async updateAccommodation(req, res, next) {
    try {
      const { id } = req.params;

      const allowed = await canManageAccommodation(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only update your own accommodations");

      const {
        name, description, address, city, country, latitude, longitude,
        phone, email, website, starRating, accommodationType, priceCategory,
        amenities, images, checkInTime, checkOutTime, policies, cancellationPolicy,
        isActive,
      } = req.body;

      const accommodation = await prisma.accommodation.update({
        where: { id },
        data: {
          ...(name              !== undefined && { name }),
          ...(description       !== undefined && { description }),
          ...(address           !== undefined && { address }),
          ...(city              !== undefined && { city }),
          ...(country           !== undefined && { country }),
          ...(latitude          !== undefined && { latitude }),
          ...(longitude         !== undefined && { longitude }),
          ...(phone             !== undefined && { phone: String(phone) }),
          ...(email             !== undefined && { email }),
          ...(website           !== undefined && { website }),
          ...(starRating        !== undefined && { starRating }),
          ...(accommodationType !== undefined && { accommodationType }),
          ...(priceCategory     !== undefined && { priceCategory }),
          ...(amenities         !== undefined && { amenities }),
          ...(images            !== undefined && { images }),
          ...(checkInTime       !== undefined && { checkInTime }),
          ...(checkOutTime      !== undefined && { checkOutTime }),
          ...(policies          !== undefined && { policies }),
          ...(cancellationPolicy !== undefined && { cancellationPolicy }),
          // isActive is only writable here by superadmin; vendors use PATCH /status
          ...(req.user.isSuperAdmin && isActive !== undefined && { isActive }),
        },
        include: { rooms: true, services: true },
      });

      invalidateAccommodationCache(id);

      return res.json({ success: true, data: accommodation, message: "Accommodation updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Accommodation not found");
      next(error);
    }
  }

  /**
   * DELETE /api/accommodations/:id
   * Vendor (own, no active bookings) / SuperAdmin
   */
  async deleteAccommodation(req, res, next) {
    try {
      const { id } = req.params;

      // Existence check before permission check for clean 404
      const existing = await prisma.accommodation.findUnique({
        where: { id }, select: { id: true },
      });
      if (!existing) return notFound(res, "Accommodation not found");

      const allowed = await canManageAccommodation(req.user, id, "delete");
      if (!allowed) {
        return badRequest(res, "Cannot delete accommodation with active bookings. Deactivate it instead.");
      }

      await prisma.accommodation.delete({ where: { id } });
      invalidateAccommodationCache(id);

      return res.json({ success: true, message: "Accommodation deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Accommodation not found");
      next(error);
    }
  }

  /**
   * PATCH /api/accommodations/:id/status  [NEW]
   * Vendor (own) — toggle active/inactive without a full update payload
   */
  async toggleAccommodationStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");

      const allowed = await canManageAccommodation(req.user, id, "update");
      if (!allowed) return forbidden(res, "You can only manage your own accommodations");

      const accommodation = await prisma.accommodation.update({
        where: { id },
        data:  { isActive },
        select: { id: true, name: true, isActive: true },
      });

      invalidateAccommodationCache(id);

      return res.json({
        success: true,
        data: accommodation,
        message: `Accommodation ${isActive ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Accommodation not found");
      next(error);
    }
  }

  /**
   * GET /api/vendor/accommodations  [NEW]
   * Vendor — their own listings, includes inactive ones
   */
  async getVendorAccommodations(req, res, next) {
    try {
      const { id: userId } = req.user;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const vendor = await prisma.vendor.findUnique({
        where: { userId }, select: { id: true },
      });
      if (!vendor) return notFound(res, "Vendor profile not found");

      const where = {
        vendorId: vendor.id,
        ...(status === "active"   && { isActive: true }),
        ...(status === "inactive" && { isActive: false }),
      };

      const [accommodations, total] = await Promise.all([
        prisma.accommodation.findMany({
          where,
          include: { _count: { select: { rooms: true, bookings: true } } },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.accommodation.count({ where }),
      ]);

      return res.json({
        success: true,
        data: accommodations,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/accommodations/:accommodationId/bookings  [NEW]
   * Vendor — view bookings for one of their accommodations
   */
  async getAccommodationBookings(req, res, next) {
    try {
      const { accommodationId } = req.params;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const allowed = await canManageAccommodation(req.user, accommodationId, "view");
      if (!allowed) return forbidden(res, "You can only view bookings for your own accommodations");

      const where = {
        accommodationId,
        ...(status && { bookingStatus: status }),
      };

      const [bookings, total] = await Promise.all([
        prisma.accommodationBooking.findMany({
          where,
          include: {
            rooms:      { select: { id: true, roomNumber: true, roomType: true } },
            travelPlan: { select: { id: true, title: true, userId: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.accommodationBooking.count({ where }),
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

  // ==================== ROOM MANAGEMENT ====================

  /**
   * POST /api/accommodations/:accommodationId/rooms
   */
  async addRoom(req, res, next) {
    try {
      const { accommodationId } = req.params;

      const allowed = await canManageRoom(req.user, accommodationId, null, "edit");
      if (!allowed) return forbidden(res, "You can only add rooms to your own accommodations");

      const {
        roomNumber, roomType, description, beds, maxOccupancy,
        hasView, hasBalcony, floor, roomAmenities, basePrice, isAvailable,
      } = req.body;

      const room = await prisma.accommodationRoom.create({
        data: {
          accommodationId,
          roomNumber, roomType,
          ...(description  !== undefined && { description }),
          ...(beds         !== undefined && { beds }),
          ...(maxOccupancy !== undefined && { maxOccupancy }),
          ...(hasView      !== undefined && { hasView }),
          ...(hasBalcony   !== undefined && { hasBalcony }),
          ...(floor        !== undefined && { floor }),
          roomAmenities: roomAmenities ?? [],
          basePrice,
          isAvailable:   isAvailable ?? true,
        },
      });

      Promise.allSettled([
        openfgaService.createRoomRelations(req.user.id, room.id, accommodationId),
        redisService.client?.del(`accommodation:${accommodationId}`),
      ]);

      return res.status(201).json({ success: true, data: room, message: "Room added successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/rooms/:roomId
   */
  async updateRoom(req, res, next) {
    try {
      const { roomId } = req.params;

      const room = await prisma.accommodationRoom.findUnique({
        where:  { id: roomId },
        select: { accommodation: { select: { id: true } } },
      });
      if (!room) return notFound(res, "Room not found");

      const allowed = await canManageRoom(req.user, room.accommodation.id, roomId, "edit");
      if (!allowed) return forbidden(res, "You can only update rooms in your own accommodations");

      const {
        roomNumber, roomType, description, beds, maxOccupancy,
        hasView, hasBalcony, floor, roomAmenities, basePrice, isAvailable,
      } = req.body;

      const updated = await prisma.accommodationRoom.update({
        where: { id: roomId },
        data: {
          ...(roomNumber    !== undefined && { roomNumber }),
          ...(roomType      !== undefined && { roomType }),
          ...(description   !== undefined && { description }),
          ...(beds          !== undefined && { beds }),
          ...(maxOccupancy  !== undefined && { maxOccupancy }),
          ...(hasView       !== undefined && { hasView }),
          ...(hasBalcony    !== undefined && { hasBalcony }),
          ...(floor         !== undefined && { floor }),
          ...(roomAmenities !== undefined && { roomAmenities }),
          ...(basePrice     !== undefined && { basePrice }),
          ...(isAvailable   !== undefined && { isAvailable }),
        },
      });

      redisService.client?.del(`accommodation:${room.accommodation.id}`).catch(() => {});

      return res.json({ success: true, data: updated, message: "Room updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Room not found");
      next(error);
    }
  }

  /**
   * DELETE /api/rooms/:roomId
   */
  async deleteRoom(req, res, next) {
    try {
      const { roomId } = req.params;

      const room = await prisma.accommodationRoom.findUnique({
        where:  { id: roomId },
        select: { accommodation: { select: { id: true } } },
      });
      if (!room) return notFound(res, "Room not found");

      const allowed = await canManageRoom(req.user, room.accommodation.id, roomId, "delete");
      if (!allowed) return forbidden(res, "You can only delete rooms in your own accommodations");

      const futureBookings = await prisma.accommodationBooking.count({
        where: {
          rooms:         { some: { id: roomId } },
          checkInDate:   { gt: new Date() },
          bookingStatus: { in: ["PENDING", "CONFIRMED"] },
        },
      });

      if (futureBookings > 0) {
        return badRequest(res, "Cannot delete room with future bookings. Mark it as unavailable instead.");
      }

      await prisma.accommodationRoom.delete({ where: { id: roomId } });
      redisService.client?.del(`accommodation:${room.accommodation.id}`).catch(() => {});

      return res.json({ success: true, message: "Room deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Room not found");
      next(error);
    }
  }

  /**
   * PATCH /api/accommodations/:accommodationId/rooms/availability  [NEW]
   * Bulk-toggle availability for multiple rooms in a single round-trip
   */
  async bulkUpdateRoomAvailability(req, res, next) {
    try {
      const { accommodationId } = req.params;
      const { roomIds, isAvailable } = req.body;

      if (!Array.isArray(roomIds) || roomIds.length === 0) {
        return badRequest(res, "roomIds must be a non-empty array");
      }
      if (typeof isAvailable !== "boolean") {
        return badRequest(res, "isAvailable must be a boolean");
      }

      const allowed = await canManageRoom(req.user, accommodationId, null, "edit");
      if (!allowed) return forbidden(res, "You can only manage rooms in your own accommodations");

      // Ownership check — all roomIds must belong to this accommodation
      const ownedCount = await prisma.accommodationRoom.count({
        where: { id: { in: roomIds }, accommodationId },
      });
      if (ownedCount !== roomIds.length) {
        return badRequest(res, "One or more room IDs do not belong to this accommodation");
      }

      const { count } = await prisma.accommodationRoom.updateMany({
        where: { id: { in: roomIds }, accommodationId },
        data:  { isAvailable },
      });

      redisService.client?.del(`accommodation:${accommodationId}`).catch(() => {});

      return res.json({
        success: true,
        updatedCount: count,
        message: `${count} room(s) ${isAvailable ? "marked available" : "marked unavailable"}`,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SERVICE MANAGEMENT ====================

  /**
   * POST /api/accommodations/:accommodationId/services
   */
  async addService(req, res, next) {
    try {
      const { accommodationId } = req.params;

      const allowed = await canManageService(req.user, accommodationId, null, "edit");
      if (!allowed) return forbidden(res, "You can only add services to your own accommodations");

      const {
        name, description, category, price, isIncluded, isAvailable,
        availableStartTime, availableEndTime, daysAvailable, locationInAccommodation,
      } = req.body;

      const service = await prisma.accommodationService.create({
        data: {
          accommodationId,
          name, category,
          ...(description             !== undefined && { description }),
          ...(price                   !== undefined && { price }),
          isIncluded:                 isIncluded  ?? false,
          isAvailable:                isAvailable ?? true,
          ...(availableStartTime      !== undefined && { availableStartTime }),
          ...(availableEndTime        !== undefined && { availableEndTime }),
          daysAvailable:              daysAvailable ?? [],
          ...(locationInAccommodation !== undefined && { locationInAccommodation }),
        },
      });

      Promise.allSettled([
        openfgaService.createServiceRelations(req.user.id, service.id, accommodationId),
        redisService.client?.del(`accommodation:${accommodationId}`),
      ]);

      return res.status(201).json({ success: true, data: service, message: "Service added successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/services/:serviceId
   */
  async updateService(req, res, next) {
    try {
      const { serviceId } = req.params;

      const service = await prisma.accommodationService.findUnique({
        where:  { id: serviceId },
        select: { accommodation: { select: { id: true } } },
      });
      if (!service) return notFound(res, "Service not found");

      const allowed = await canManageService(req.user, service.accommodation.id, serviceId, "edit");
      if (!allowed) return forbidden(res, "You can only update services in your own accommodations");

      const {
        name, description, category, price, isIncluded, isAvailable,
        availableStartTime, availableEndTime, daysAvailable, locationInAccommodation,
      } = req.body;

      const updated = await prisma.accommodationService.update({
        where: { id: serviceId },
        data: {
          ...(name                    !== undefined && { name }),
          ...(description             !== undefined && { description }),
          ...(category                !== undefined && { category }),
          ...(price                   !== undefined && { price }),
          ...(isIncluded              !== undefined && { isIncluded }),
          ...(isAvailable             !== undefined && { isAvailable }),
          ...(availableStartTime      !== undefined && { availableStartTime }),
          ...(availableEndTime        !== undefined && { availableEndTime }),
          ...(daysAvailable           !== undefined && { daysAvailable }),
          ...(locationInAccommodation !== undefined && { locationInAccommodation }),
        },
      });

      redisService.client?.del(`accommodation:${service.accommodation.id}`).catch(() => {});

      return res.json({ success: true, data: updated, message: "Service updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Service not found");
      next(error);
    }
  }

  /**
   * DELETE /api/services/:serviceId
   */
  async deleteService(req, res, next) {
    try {
      const { serviceId } = req.params;

      const service = await prisma.accommodationService.findUnique({
        where:  { id: serviceId },
        select: { accommodation: { select: { id: true } } },
      });
      if (!service) return notFound(res, "Service not found");

      const allowed = await canManageService(req.user, service.accommodation.id, serviceId, "delete");
      if (!allowed) return forbidden(res, "You can only delete services in your own accommodations");

      await prisma.accommodationService.delete({ where: { id: serviceId } });
      redisService.client?.del(`accommodation:${service.accommodation.id}`).catch(() => {});

      return res.json({ success: true, message: "Service deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Service not found");
      next(error);
    }
  }

  // ==================== BOOKING MANAGEMENT ====================

  /**
   * POST /api/travel-plans/:travelPlanId/accommodation-bookings
   *
   * SCHEMA FIX: AccommodationBooking no longer has `selectedRoomNumbers[]`
   * (removed — duplicated the rooms relation) and has no `totalNights` field
   * (removed — derivable). Rooms are now linked via `rooms: { connect }`.
   * Client must send `roomIds: string[]` instead of `selectedRoomNumbers`.
   */
  async createBooking(req, res, next) {
    try {
      const { travelPlanId } = req.params;
      const {
        accommodationId, roomIds,
        checkInDate, checkOutDate, totalGuests, roomType,
        pricePerNight, taxes, serviceFee, totalCost,
        guestName, guestEmail, guestPhone, specialRequests,
        paymentStatus, paymentMethod, transactionId,
      } = req.body;

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelPlan?.(req.user.id, travelPlanId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      const checkIn  = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);

      if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
        return badRequest(res, "Invalid check-in or check-out date");
      }
      if (checkOut <= checkIn) return badRequest(res, "Check-out date must be after check-in date");
      if (!Array.isArray(roomIds) || roomIds.length === 0) {
        return badRequest(res, "At least one roomId is required");
      }

      // Verify accommodation + room availability in one batch
      const [accommodation, availableRooms] = await Promise.all([
        prisma.accommodation.findUnique({
          where:  { id: accommodationId },
          select: { id: true, isActive: true },
        }),
        prisma.accommodationRoom.findMany({
          where:  { id: { in: roomIds }, accommodationId, isAvailable: true },
          select: { id: true },
        }),
      ]);

      if (!accommodation)          return notFound(res, "Accommodation not found");
      if (!accommodation.isActive) return badRequest(res, "Accommodation is not currently available");
      if (availableRooms.length !== roomIds.length) {
        return badRequest(res, "One or more selected rooms are not available or do not belong to this accommodation");
      }

      // Date-overlap conflict check via the rooms relation (not selectedRoomNumbers)
      const conflictCount = await prisma.accommodationBooking.count({
        where: {
          accommodationId,
          bookingStatus: { in: ACTIVE_BOOKING_STATUSES },
          rooms:         { some: { id: { in: roomIds } } },
          AND: [
            { checkInDate:  { lt: checkOut } },
            { checkOutDate: { gt: checkIn } },
          ],
        },
      });

      if (conflictCount > 0) {
        return res.status(409).json({ success: false, message: "One or more rooms are already booked for these dates" });
      }

      const booking = await prisma.accommodationBooking.create({
        data: {
          travelPlanId,
          accommodationId,
          checkInDate:  checkIn,
          checkOutDate: checkOut,
          totalGuests:  totalGuests ?? 1,
          roomType,
          pricePerNight,
          ...(taxes      !== undefined && { taxes }),
          ...(serviceFee !== undefined && { serviceFee }),
          totalCost,
          guestName,
          guestEmail,
          ...(guestPhone      !== undefined && { guestPhone }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentStatus   !== undefined && { paymentStatus }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
          ...(transactionId   !== undefined && { transactionId }),
          rooms: { connect: roomIds.map((id) => ({ id })) },
        },
        include: { accommodation: true, rooms: true },
      });

      Promise.allSettled([
        openfgaService.createAccommodationBookingRelations(req.user.id, booking.id, travelPlanId),
        redisService.client?.del(`travelplan:${travelPlanId}`),
      ]);

      return res.status(201).json({
        success: true,
        data: booking,
        message: "Accommodation booking created successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/accommodation-bookings/:bookingId
   * FIX: permission check now runs after existence check, not before
   */
  async getBookingById(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where: { id: bookingId },
        include: {
          accommodation: true,
          rooms:         true,
          travelPlan:    { select: { id: true, title: true, userId: true } },
        },
      });

      if (!booking) return notFound(res, "Booking not found");

      const canView =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canViewAccommodationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canView) return forbidden(res, "You do not have permission to view this booking");

      return res.json({ success: true, data: booking });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/accommodation-bookings/:bookingId
   * FIX: fetch booking before permission check (avoids silent 403 on non-existent bookings)
   */
  async updateBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where:  { id: bookingId },
        select: { bookingStatus: true, travelPlanId: true, accommodationId: true },
      });

      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_BOOKING_STATUSES.includes(booking.bookingStatus)) {
        return badRequest(res, `Cannot update booking with status: ${booking.bookingStatus}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditAccommodationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        checkInDate, checkOutDate, totalGuests, specialRequests,
        paymentStatus, paymentMethod, bookingStatus,
      } = req.body;

      const updated = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: {
          ...(checkInDate     !== undefined && { checkInDate:  new Date(checkInDate) }),
          ...(checkOutDate    !== undefined && { checkOutDate: new Date(checkOutDate) }),
          ...(totalGuests     !== undefined && { totalGuests }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentStatus   !== undefined && { paymentStatus }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
          ...(bookingStatus   !== undefined && { bookingStatus }),
        },
        include: { accommodation: true, rooms: true },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`),
      ]);

      return res.json({ success: true, data: updated, message: "Booking updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/accommodation-bookings/:bookingId
   */
  async cancelBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where:  { id: bookingId },
        select: { bookingStatus: true, paymentStatus: true, travelPlanId: true, accommodationId: true },
      });

      if (!booking) return notFound(res, "Booking not found");
      if (booking.bookingStatus === "CANCELLED") return badRequest(res, "Booking is already cancelled");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelAccommodationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this booking");

      const cancelled = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: {
          bookingStatus: "CANCELLED",
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus,
        },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`),
      ]);

      return res.json({ success: true, data: cancelled, message: "Booking cancelled successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/accommodations/:accommodationId/available-rooms
   * Public — uses room relation for conflict check (not selectedRoomNumbers)
   */
  async getAvailableRooms(req, res, next) {
    try {
      const { accommodationId } = req.params;
      const { checkIn, checkOut, guests } = req.query;

      if (!checkIn || !checkOut) return badRequest(res, "Check-in and check-out dates are required");

      const checkInDate  = new Date(checkIn);
      const checkOutDate = new Date(checkOut);

      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        return badRequest(res, "Invalid date format");
      }
      if (checkOutDate <= checkInDate) return badRequest(res, "Check-out must be after check-in");

      const guestCount = parseIntParam(guests, 1);

      const allRooms = await prisma.accommodationRoom.findMany({
        where: { accommodationId, isAvailable: true, maxOccupancy: { gte: guestCount } },
      });

      if (allRooms.length === 0) {
        return res.json({ success: true, data: [], totalAvailable: 0, totalRooms: 0 });
      }

      // Collect all room IDs booked during the overlap window
      const bookedBookings = await prisma.accommodationBooking.findMany({
        where: {
          accommodationId,
          bookingStatus: { in: ACTIVE_BOOKING_STATUSES },
          rooms:         { some: { id: { in: allRooms.map((r) => r.id) } } },
          AND: [
            { checkInDate:  { lt: checkOutDate } },
            { checkOutDate: { gt: checkInDate } },
          ],
        },
        select: { rooms: { select: { id: true } } },
      });

      const bookedRoomIds = new Set(bookedBookings.flatMap((b) => b.rooms.map((r) => r.id)));
      const availableRooms = allRooms.filter((r) => !bookedRoomIds.has(r.id));

      return res.json({
        success: true,
        data: availableRooms,
        totalAvailable: availableRooms.length,
        totalRooms:     allRooms.length,
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN ENDPOINTS ====================

  /**
   * GET /api/admin/accommodations  [NEW]
   * SuperAdmin — full listing with vendor/status/feature filters
   */
  async adminGetAllAccommodations(req, res, next) {
    try {
      const {
        vendorId, isActive, isVerified, isFeatured,
        city, country, search, sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [];
      if (vendorId)           AND.push({ vendorId });
      if (isActive   !== undefined) AND.push({ isActive:   isActive   === "true" });
      if (isVerified !== undefined) AND.push({ isVerified: isVerified === "true" });
      if (isFeatured !== undefined) AND.push({ isFeatured: isFeatured === "true" });
      if (city)    AND.push({ city:    { contains: city,    mode: "insensitive" } });
      if (country) AND.push({ country: { contains: country, mode: "insensitive" } });
      if (search) AND.push({
        OR: [
          { name:        { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });

      const where = AND.length ? { AND } : {};

      const [accommodations, total] = await Promise.all([
        prisma.accommodation.findMany({
          where,
          include: {
            vendor: { select: { id: true, businessName: true, businessEmail: true } },
            _count: { select: { rooms: true, bookings: true } },
          },
          skip,
          take: limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.accommodation.count({ where }),
      ]);

      return res.json({
        success: true,
        data: accommodations,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/accommodations/:id/verify  [NEW]
   * SuperAdmin — verify or unverify an accommodation
   */
  async verifyAccommodation(req, res, next) {
    try {
      const { id } = req.params;
      const { isVerified } = req.body;

      if (typeof isVerified !== "boolean") return badRequest(res, "isVerified must be a boolean");

      const existing = await prisma.accommodation.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Accommodation not found");

      const accommodation = await prisma.accommodation.update({
        where:  { id },
        data:   { isVerified },
        select: { id: true, name: true, isVerified: true },
      });

      invalidateAccommodationCache(id);

      return res.json({
        success: true,
        data: accommodation,
        message: `Accommodation ${isVerified ? "verified" : "unverified"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/accommodations/:id/feature  [NEW]
   * SuperAdmin — feature or unfeature an accommodation with optional expiry
   */
  async featureAccommodation(req, res, next) {
    try {
      const { id } = req.params;
      const { isFeatured, featuredUntil } = req.body;

      if (typeof isFeatured !== "boolean") return badRequest(res, "isFeatured must be a boolean");

      const existing = await prisma.accommodation.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return notFound(res, "Accommodation not found");

      const accommodation = await prisma.accommodation.update({
        where:  { id },
        data: {
          isFeatured,
          featuredUntil: isFeatured && featuredUntil ? new Date(featuredUntil) : null,
        },
        select: { id: true, name: true, isFeatured: true, featuredUntil: true },
      });

      invalidateAccommodationCache(id);

      return res.json({
        success: true,
        data: accommodation,
        message: `Accommodation ${isFeatured ? "featured" : "unfeatured"} successfully`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/accommodation-bookings  [NEW]
   * SuperAdmin — all bookings across all vendors with date/status filtering
   */
  async adminGetAllBookings(req, res, next) {
    try {
      const { status, accommodationId, from, to } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const AND = [];
      if (accommodationId) AND.push({ accommodationId });
      if (status)          AND.push({ bookingStatus: status });
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
        prisma.accommodationBooking.findMany({
          where,
          include: {
            accommodation: { select: { id: true, name: true, city: true } },
            rooms:         { select: { id: true, roomNumber: true, roomType: true } },
            travelPlan:    { select: { id: true, title: true, userId: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.accommodationBooking.count({ where }),
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
   * PATCH /api/admin/accommodation-bookings/:bookingId/status  [NEW]
   * SuperAdmin — force any booking to any status (e.g. resolve disputes)
   */
  async adminUpdateBookingStatus(req, res, next) {
    try {
      const { bookingId } = req.params;
      const { bookingStatus, notes } = req.body;

      const booking = await prisma.accommodationBooking.findUnique({
        where:  { id: bookingId },
        select: { id: true, travelPlanId: true, accommodationId: true },
      });

      if (!booking) return notFound(res, "Booking not found");

      const updated = await prisma.accommodationBooking.update({
        where: { id: bookingId },
        data: {
          bookingStatus,
          ...(notes && { aiNotes: notes }),
        },
      });

      Promise.allSettled([
        redisService.client?.del(`travelplan:${booking.travelPlanId}`),
        redisService.client?.del(`accommodation:${booking.accommodationId}`),
      ]);

      return res.json({
        success: true,
        data: updated,
        message: `Booking status updated to ${bookingStatus}`,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AccommodationController();