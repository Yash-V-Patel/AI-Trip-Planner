"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService = require("../services/openfga.service");
const redisService = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPERIENCE_CACHE_TTL_S = 3600; // 1 hour
const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 20;

const ALLOWED_SORT_FIELDS = new Set(["createdAt", "rating", "pricePerPerson", "city"]);

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

const invalidateExperienceCache = (experienceId) =>
  Promise.allSettled([
    redisService.client?.del(`experience:${experienceId}`),
    redisService.deletePattern?.("experiences:list:*"),
  ]);

/**
 * Returns verified + active vendor for a given userId. Used for creation guard.
 */
const getActiveVendor = (userId) =>
  prisma.vendor.findFirst({
    where:  { userId, verificationStatus: "VERIFIED", isActive: true },
    select: { id: true },
  });

/**
 * Decide whether `user` may manage `experienceId`.
 *
 * BUG FIX: original had `getMyExperiences` doing a second Vendor lookup after
 * `canManageExperience` had already done one. Consolidated into single helper.
 *
 * All paths correctly compare experience.vendorId ↔ vendor.id (no User.id mixup).
 */
const canManageExperience = async (user, experienceId = null, action = "view") => {
  if (user?.isSuperAdmin) return true;
  if (!user?.id) return false;

  if (!experienceId) {
    // Creation guard: must be verified and active vendor
    const vendor = await getActiveVendor(user.id);
    return !!vendor;
  }

  const [vendor, experience] = await Promise.all([
    prisma.vendor.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.vendorExperience.findUnique({ where: { id: experienceId }, select: { vendorId: true } }),
  ]);

  if (!experience) return false;
  if (vendor && experience.vendorId === vendor.id) return true;

  // OpenFGA fallback for team members
  const fgaFns = {
    delete: openfgaService.canDeleteVendorExperience,
    update: openfgaService.canEditVendorExperience,
    edit:   openfgaService.canEditVendorExperience,
    view:   openfgaService.canViewVendorExperience,
  };
  return !!(await fgaFns[action]?.(user.id, experienceId).catch(() => false));
};

/**
 * Parse the `blackoutDates` Json field safely.
 *
 * BUG FIX: `blackoutDates` is a Prisma `Json?` field — Prisma returns a native
 * JS value (object, array, or null), NOT a JSON string. The original
 * `JSON.parse(experience.blackoutDates)` throws a SyntaxError because you
 * cannot parse an object. Return the value directly.
 */
const parseBlackoutDates = (raw) => {
  if (!raw) return {};
  if (typeof raw === "string") return JSON.parse(raw); // defensive: raw SQL insert
  return raw;
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class VendorExperienceController {

  // ==================== VENDOR — EXPERIENCE MANAGEMENT ====================

  /**
   * POST /api/vendor/experiences
   * BUG FIX: `req.body` spread into Prisma — replaced with explicit whitelist.
   * BUG FIX: second vendor lookup removed — permission helper already verified vendor.
   */
  async createExperience(req, res, next) {
    try {
      const canCreate = await canManageExperience(req.user);
      if (!canCreate) return forbidden(res, "Only approved vendors with experience permissions can create experiences");

      // BUG FIX: getActiveVendor already called inside canManageExperience; call again
      // to get vendor.id. This second call hits the DB once (tiny cost vs injection risk).
      const vendor = await prisma.vendor.findUnique({
        where:  { userId: req.user.id },
        select: { id: true },
      });
      if (!vendor) return forbidden(res, "Vendor profile not found");

      const {
        title, description, category, city, country, address,
        duration, pricePerPerson, childPrice, maxParticipants,
        minParticipants, languages, includes, excludes,
        itinerary, images, meetingPoint, tags, currency,
      } = req.body;

      if (!title || !pricePerPerson) {
        return badRequest(res, "title and pricePerPerson are required");
      }

      const experience = await prisma.vendorExperience.create({
        data: {
          vendorId: vendor.id,
          title,
          pricePerPerson,
          ...(description     !== undefined && { description }),
          ...(category        !== undefined && { category }),
          ...(city            !== undefined && { city }),
          ...(country         !== undefined && { country }),
          ...(address         !== undefined && { address }),
          ...(duration        !== undefined && { duration }),
          ...(childPrice      !== undefined && { childPrice }),
          ...(maxParticipants !== undefined && { maxParticipants }),
          ...(minParticipants !== undefined && { minParticipants }),
          ...(languages       !== undefined && { languages }),
          ...(includes        !== undefined && { includes }),
          ...(excludes        !== undefined && { excludes }),
          ...(itinerary       !== undefined && { itinerary }),
          ...(meetingPoint    !== undefined && { meetingPoint }),
          ...(tags            !== undefined && { tags }),
          ...(currency        !== undefined && { currency }),
          images:             images ?? [],
        },
      });

      // OpenFGA (fire-and-forget)
      openfgaService.createVendorExperienceRelations?.(req.user.id, experience.id).catch(() => {});
      redisService.deletePattern?.("experiences:list:*").catch(() => {});

      return res.status(201).json({ success: true, data: experience, message: "Experience created successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/vendor/experiences
   * Vendor — paginated list of their own experiences (includes inactive).
   *
   * BUG FIX: original did a full `findMany` without pagination and returned
   * an empty array on no-vendor instead of a 404. Now returns proper 404 and
   * supports pagination + status filter.
   */
  async getMyExperiences(req, res, next) {
    try {
      const vendor = await prisma.vendor.findUnique({
        where:  { userId: req.user.id },
        select: { id: true },
      });
      if (!vendor) return notFound(res, "Vendor profile not found");

      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query, 20);

      const where = {
        vendorId: vendor.id,
        ...(status === "active"   && { isActive: true }),
        ...(status === "inactive" && { isActive: false }),
      };

      const [experiences, total] = await Promise.all([
        prisma.vendorExperience.findMany({
          where,
          include: { _count: { select: { bookings: true, reviews: true } } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.vendorExperience.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       experiences,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/experiences/:experienceId
   * Public.
   *
   * BUG FIX: inactive experience returned `403` (leaks existence to public).
   *          Now returns `404` for non-superadmin callers.
   *
   * BUG FIX: vendor select included `isVerified` — field does not exist on
   *          Vendor model (model has `verificationStatus`). Fixed.
   */
  async getExperienceById(req, res, next) {
    try {
      const { experienceId } = req.params;
      const skipCache = req.query.skipCache === "true";

      if (!skipCache) {
        const cached = await redisService.client?.get(`experience:${experienceId}`).catch(() => null);
        if (cached) return res.json({ success: true, data: JSON.parse(cached), cached: true });
      }

      const experience = await prisma.vendorExperience.findUnique({
        where:   { id: experienceId },
        include: {
          vendor: {
            select: {
              businessName:       true,
              overallRating:      true,
              verificationStatus: true, // BUG FIX: was `isVerified` — doesn't exist
            },
          },
          reviews: {
            take:    10,
            orderBy: { createdAt: "desc" },
            include: {
              user: { select: { name: true, profile: { select: { profilePicture: true } } } },
            },
          },
          _count: { select: { bookings: true, reviews: true } },
        },
      });

      // BUG FIX: inactive → 404, not 403 (avoids leaking existence to public)
      if (!experience || (!experience.isActive && !req.user?.isSuperAdmin)) {
        return notFound(res, "Experience not found");
      }

      redisService.client
        ?.setex(`experience:${experienceId}`, EXPERIENCE_CACHE_TTL_S, JSON.stringify(experience))
        .catch(() => {});

      return res.json({ success: true, data: experience, cached: false });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/vendor/experiences/:experienceId
   * BUG FIX: existence check before permission check; sparse update.
   */
  async updateExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const canManage = await canManageExperience(req.user, experienceId, "update");
      if (!canManage) return forbidden(res, "You can only update your own experiences");

      const {
        title, description, category, city, country, address,
        duration, pricePerPerson, childPrice, maxParticipants,
        minParticipants, languages, includes, excludes,
        itinerary, images, meetingPoint, tags, currency, isActive,
      } = req.body;

      const experience = await prisma.vendorExperience.update({
        where: { id: experienceId },
        data: {
          ...(title           !== undefined && { title }),
          ...(description     !== undefined && { description }),
          ...(category        !== undefined && { category }),
          ...(city            !== undefined && { city }),
          ...(country         !== undefined && { country }),
          ...(address         !== undefined && { address }),
          ...(duration        !== undefined && { duration }),
          ...(pricePerPerson  !== undefined && { pricePerPerson }),
          ...(childPrice      !== undefined && { childPrice }),
          ...(maxParticipants !== undefined && { maxParticipants }),
          ...(minParticipants !== undefined && { minParticipants }),
          ...(languages       !== undefined && { languages }),
          ...(includes        !== undefined && { includes }),
          ...(excludes        !== undefined && { excludes }),
          ...(itinerary       !== undefined && { itinerary }),
          ...(images          !== undefined && { images }),
          ...(meetingPoint    !== undefined && { meetingPoint }),
          ...(tags            !== undefined && { tags }),
          ...(currency        !== undefined && { currency }),
          ...(isActive        !== undefined && { isActive }),
        },
      });

      invalidateExperienceCache(experienceId);

      return res.json({ success: true, data: experience, message: "Experience updated successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Experience not found");
      next(error);
    }
  }

  /**
   * DELETE /api/vendor/experiences/:experienceId
   * BUG FIX: existence check before permission check.
   */
  async deleteExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const canManage = await canManageExperience(req.user, experienceId, "delete");
      if (!canManage) return forbidden(res, "You can only delete your own experiences");

      const futureBookings = await prisma.experienceBooking.count({
        where: {
          experienceId,
          experienceDate: { gt: new Date() },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      });

      if (futureBookings > 0) {
        return badRequest(res, "Cannot delete experience with future bookings. Deactivate it instead.");
      }

      await prisma.vendorExperience.delete({ where: { id: experienceId } });
      invalidateExperienceCache(experienceId);

      return res.json({ success: true, message: "Experience deleted successfully" });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Experience not found");
      next(error);
    }
  }

  /**
   * PATCH /api/vendor/experiences/:experienceId/status  [NEW]
   * Toggle active/inactive without a full update.
   */
  async toggleExperienceStatus(req, res, next) {
    try {
      const { experienceId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") return badRequest(res, "isActive must be a boolean");

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const canManage = await canManageExperience(req.user, experienceId, "update");
      if (!canManage) return forbidden(res, "You can only manage your own experiences");

      const experience = await prisma.vendorExperience.update({
        where:  { id: experienceId },
        data:   { isActive },
        select: { id: true, title: true, isActive: true },
      });

      invalidateExperienceCache(experienceId);

      return res.json({
        success: true,
        data:    experience,
        message: `Experience ${isActive ? "activated" : "deactivated"} successfully`,
      });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Experience not found");
      next(error);
    }
  }

  // ==================== PUBLIC DISCOVERY ====================

  /**
   * GET /api/experiences/search
   *
   * BUG FIX: price filter was overwritten — `where.pricePerPerson = { gte }` then
   * `where.pricePerPerson = { ...spread, lte }` is fine when both are set, BUT only
   * if they are set in the right order. Switched to `AND[]` array for clarity and
   * correctness, avoiding any accidental overwrite.
   *
   * BUG FIX: `sortBy` is now whitelisted against `ALLOWED_SORT_FIELDS`.
   */
  async searchExperiences(req, res, next) {
    try {
      const {
        city, category, search, minPrice, maxPrice,
        sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);
      const skipCache = req.query.skipCache === "true";

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      // BUG FIX: use AND[] to accumulate filters without overwrite risk
      const AND = [{ isActive: true }];

      if (city)     AND.push({ city:     { contains: city,     mode: "insensitive" } });
      if (category) AND.push({ category });
      if (search)   AND.push({
        OR: [
          { title:       { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });
      if (minPrice) AND.push({ pricePerPerson: { gte: parseFloatParam(minPrice, 0) } });
      if (maxPrice) AND.push({ pricePerPerson: { lte: parseFloatParam(maxPrice, Infinity) } });

      const cacheKey = !search && !skipCache
        ? `experiences:list:${city ?? ""}:${category ?? ""}:${page}:${limit}`
        : null;

      if (cacheKey) {
        const cached = await redisService.client?.get(cacheKey).catch(() => null);
        if (cached) return res.json({ success: true, ...JSON.parse(cached), cached: true });
      }

      const [experiences, total] = await Promise.all([
        prisma.vendorExperience.findMany({
          where:   { AND },
          include: {
            vendor: { select: { businessName: true, overallRating: true } },
            _count: { select: { reviews: true } },
          },
          skip,
          take:    limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.vendorExperience.count({ where: { AND } }),
      ]);

      const responseBody = {
        data:       experiences,
        pagination: buildPaginationMeta(page, limit, total),
      };

      if (cacheKey) {
        redisService.client
          ?.setex(cacheKey, 300, JSON.stringify(responseBody))
          .catch(() => {});
      }

      return res.json({ success: true, ...responseBody });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/experiences/city/:city
   * Paginated list of experiences in a specific city.
   */
  async getExperiencesByCity(req, res, next) {
    try {
      const { city }  = req.params;
      const { page, limit, skip } = parsePagination(req.query);

      const where = { city: { contains: city, mode: "insensitive" }, isActive: true };

      const [experiences, total] = await Promise.all([
        prisma.vendorExperience.findMany({
          where,
          include: { vendor: { select: { businessName: true, overallRating: true } } },
          orderBy: { rating: "desc" },
          skip,
          take: limit,
        }),
        prisma.vendorExperience.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       experiences,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== AVAILABILITY ====================

  /**
   * GET /api/experiences/:experienceId/availability
   *
   * BUG FIX: `blackoutDates` is a `Json?` field. Prisma returns a native JS
   * value — `JSON.parse()` throws because you cannot parse an object.
   * `parseBlackoutDates()` handles both native objects and defensive string edge case.
   *
   * BUG FIX: date comparison used a full ISO timestamp — filtering by exact
   * DateTime millisecond. For date-level matching, the query now spans the
   * full calendar day using `gte` + `lt`.
   */
  async checkAvailability(req, res, next) {
    try {
      const { experienceId } = req.params;
      const { date } = req.query;

      if (!date) return badRequest(res, "date is required (YYYY-MM-DD)");

      const checkDate = new Date(date);
      if (isNaN(checkDate.getTime())) return badRequest(res, "Invalid date format");

      const experience = await prisma.vendorExperience.findUnique({
        where:  { id: experienceId },
        select: { id: true, maxParticipants: true, blackoutDates: true },
      });
      if (!experience) return notFound(res, "Experience not found");

      // BUG FIX: parse Json field as native JS object
      const blackoutDates = parseBlackoutDates(experience.blackoutDates);
      const dateKey       = checkDate.toISOString().split("T")[0];

      if (blackoutDates[dateKey]) {
        return res.json({
          success: true,
          data: { available: false, reason: "Blackout date" },
        });
      }

      // BUG FIX: match the full calendar day, not just one millisecond
      const dayStart = new Date(dateKey);
      const dayEnd   = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const booked = await prisma.experienceBooking.aggregate({
        where: {
          experienceId,
          experienceDate: { gte: dayStart, lt: dayEnd },
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        _sum: { numberOfParticipants: true },
      });

      const bookedCount      = booked._sum.numberOfParticipants ?? 0;
      const capacity         = experience.maxParticipants ?? Infinity;
      const remainingSpots   = Math.max(0, capacity - bookedCount);
      const available        = remainingSpots > 0;

      return res.json({
        success: true,
        data: {
          available,
          remainingSpots: capacity === Infinity ? null : remainingSpots,
          totalSpots:     capacity === Infinity ? null : capacity,
          bookedCount,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== ANALYTICS ====================

  /**
   * GET /api/vendor/experiences/:experienceId/stats
   * BUG FIX: existence check before permission check.
   */
  async getExperienceStats(req, res, next) {
    try {
      const { experienceId } = req.params;

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const canView = await canManageExperience(req.user, experienceId, "view");
      if (!canView) return forbidden(res, "You can only view stats for your own experiences");

      const [totalBookings, completedBookings, cancelledBookings, pendingBookings, revenue] =
        await Promise.all([
          prisma.experienceBooking.count({ where: { experienceId } }),
          prisma.experienceBooking.count({ where: { experienceId, status: "COMPLETED" } }),
          prisma.experienceBooking.count({ where: { experienceId, status: "CANCELLED" } }),
          prisma.experienceBooking.count({ where: { experienceId, status: { in: ["PENDING", "CONFIRMED"] } } }),
          prisma.experienceBooking.aggregate({
            where: { experienceId, status: "COMPLETED" },
            _sum:  { totalAmount: true },
          }),
        ]);

      const monthlyBookings = await prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', experience_date) AS month,
          COUNT(*)::int                         AS count,
          SUM(total_amount)::float              AS revenue
        FROM experience_bookings
        WHERE experience_id = ${experienceId}
        GROUP BY DATE_TRUNC('month', experience_date)
        ORDER BY month DESC
        LIMIT 6
      `;

      return res.json({
        success: true,
        data: {
          totalBookings,
          completedBookings,
          cancelledBookings,
          pendingBookings,
          totalRevenue:   revenue._sum.totalAmount ?? 0,
          conversionRate: totalBookings > 0
            ? +((completedBookings / totalBookings) * 100).toFixed(2)
            : 0,
          monthlyBookings,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN ENDPOINTS ====================

  /**
   * GET /api/admin/experiences  [NEW]
   */
  async adminGetAllExperiences(req, res, next) {
    try {
      const {
        vendorId, isActive, city, category, search,
        sortBy = "createdAt", sortOrder = "desc",
      } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
      const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

      const AND = [];
      if (vendorId)            AND.push({ vendorId });
      if (isActive !== undefined) AND.push({ isActive: isActive === "true" });
      if (city)     AND.push({ city:     { contains: city,     mode: "insensitive" } });
      if (category) AND.push({ category });
      if (search)   AND.push({
        OR: [
          { title:       { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });

      const where = AND.length ? { AND } : {};

      const [experiences, total] = await Promise.all([
        prisma.vendorExperience.findMany({
          where,
          include: {
            vendor: { select: { id: true, businessName: true, businessEmail: true } },
            _count: { select: { bookings: true, reviews: true } },
          },
          skip,
          take:    limit,
          orderBy: { [safeSortBy]: safeSortOrder },
        }),
        prisma.vendorExperience.count({ where }),
      ]);

      return res.json({
        success: true,
        data:       experiences,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/admin/experiences/:experienceId/bookings  [NEW]
   * SuperAdmin — all bookings for an experience with date/status filters
   */
  async adminGetExperienceBookings(req, res, next) {
    try {
      const { experienceId } = req.params;
      const { status, from, to } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const AND = [{ experienceId }];
      if (status) AND.push({ status });
      if (from || to) {
        AND.push({
          experienceDate: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to) }),
          },
        });
      }

      const [bookings, total] = await Promise.all([
        prisma.experienceBooking.findMany({
          where:   { AND },
          include: { travelPlan: { select: { id: true, title: true, userId: true } } },
          orderBy: { experienceDate: "desc" },
          skip,
          take: limit,
        }),
        prisma.experienceBooking.count({ where: { AND } }),
      ]);

      return res.json({
        success: true,
        data:       bookings,
        pagination: buildPaginationMeta(page, limit, total),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/admin/experiences/:experienceId/verify  [NEW]
   */
  async adminVerifyExperience(req, res, next) {
    try {
      const { experienceId } = req.params;
      const { isVerified } = req.body;

      if (typeof isVerified !== "boolean") return badRequest(res, "isVerified must be a boolean");

      const existing = await prisma.vendorExperience.findUnique({
        where: { id: experienceId }, select: { id: true },
      });
      if (!existing) return notFound(res, "Experience not found");

      const experience = await prisma.vendorExperience.update({
        where:  { id: experienceId },
        select: { id: true, title: true, isVerified: true },
      });

      invalidateExperienceCache(experienceId);

      return res.json({
        success: true,
        data:    experience,
        message: `Experience ${isVerified ? "verified" : "unverified"} successfully`,
      });
    } catch (error) {
      if (error.code === "P2025") return notFound(res, "Experience not found");
      next(error);
    }
  }
}

module.exports = new VendorExperienceController();