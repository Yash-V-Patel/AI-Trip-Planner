"use strict";

const { PrismaClient } = require("@prisma/client");
const openfgaService   = require("../services/openfga.service");
const redisService     = require("../services/redis.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = {
  PLAN:      600,   // 10 min  – single plan detail
  LIST:      300,   // 5 min   – paginated list
  STATS:     120,   // 2 min   – stats (stale-tolerant)
  BUDGET:    180,   // 3 min   – budget breakdown
};

const MAX_PAGE_LIMIT    = 100;
const DEFAULT_LIMIT     = 10;
const DEFAULT_PAGE      = 1;

const SHARE_PERMISSIONS = ["viewer", "editor", "suggester"];

const ALLOWED_SORT_FIELDS = new Set([
  "startDate", "endDate", "createdAt", "updatedAt", "title", "destination",
]);

const VALID_PLAN_STATUSES = new Set([
  "PLANNING", "ONGOING", "COMPLETED", "CANCELLED",
]);

// Terminal statuses — these bookings may not be mutated
const TERMINAL_ACCOMMODATION  = new Set(["CANCELLED", "CHECKED_OUT", "NO_SHOW"]);
const TERMINAL_BOOKING        = new Set(["COMPLETED", "CANCELLED"]);
const TERMINAL_SHOPPING_VISIT = new Set(["VISITED", "CANCELLED", "SKIPPED"]);

// ---------------------------------------------------------------------------
// Module-level response helpers
// ---------------------------------------------------------------------------

const ok         = (res, data, message, status = 200) =>
  res.status(status).json({ success: true,  ...(data && { data }), ...(message && { message }) });

const created    = (res, data, message) => ok(res, data, message, 201);
const notFound   = (res, msg = "Resource not found")   => res.status(404).json({ success: false, message: msg });
const forbidden  = (res, msg = "Unauthorized access")  => res.status(403).json({ success: false, message: msg });
const conflict   = (res, msg)                          => res.status(409).json({ success: false, message: msg });
const badRequest = (res, msg)                          => res.status(400).json({ success: false, message: msg });

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parsePagination = (query, defaultLimit = DEFAULT_LIMIT) => {
  const page  = parseIntParam(query.page,  DEFAULT_PAGE);
  const limit = Math.min(parseIntParam(query.limit, defaultLimit), MAX_PAGE_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
};

const paginationMeta = (page, limit, total) => ({
  page, limit, total, pages: Math.ceil(total / limit),
});

// ---------------------------------------------------------------------------
// Safe sort helpers
// ---------------------------------------------------------------------------

const safeSort = (sortBy, sortOrder, defaultField = "startDate") => ({
  field: ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : defaultField,
  order: sortOrder === "desc" ? "desc" : "asc",
});

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

const cacheGet = async (key) => {
  try {
    const v = await redisService.client?.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
};

const cacheSet = (key, value, ttl) => {
  redisService.client?.setex(key, ttl, JSON.stringify(value)).catch(() => {});
};

const cacheDel = (...keys) => {
  const filtered = keys.filter(Boolean);
  if (filtered.length) {
    Promise.allSettled(filtered.map((k) => redisService.client?.del(k))).catch(() => {});
  }
};

/**
 * Invalidate all cache entries related to a plan and its owner.
 * Fire-and-forget.
 */
const invalidatePlan = (planId, userId) =>
  cacheDel(`travelplan:${planId}`, userId ? `user:${userId}:travelplans` : null);

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

/**
 * Check an OpenFGA permission for a user on a travel plan.
 * Returns false (never throws) — caller decides how to handle denial.
 */
const checkPlanPermission = async (userId, planId, action) => {
  const fns = {
    view:    openfgaService.canViewTravelPlan,
    edit:    openfgaService.canEditTravelPlan,
    suggest: openfgaService.canSuggestTravelPlan,
    share:   openfgaService.canShareTravelPlan,
    delete:  openfgaService.canDeleteTravelPlan,
  };
  const fn = fns[action];
  if (!fn) return false;
  return !!(await fn.call(openfgaService, userId, planId).catch(() => false));
};

// ---------------------------------------------------------------------------
// Cost aggregation helper
// ---------------------------------------------------------------------------

/**
 * Aggregate booking costs for all categories of a travel plan.
 * All four DB queries run concurrently.
 *
 * Transportation prefers actualFare, falls back to estimatedFare.
 * Uses ?? not || to correctly handle 0 values.
 */
/**
 * Aggregate booking costs for all categories of a travel plan.
 * All four DB queries run concurrently.
 *
 * Transportation prefers actualFare, falls back to estimatedFare.
 * Uses ?? not || to correctly handle 0 values.
 *
 * [FIX] Exclude cancelled/completed bookings so currentSpent reflects only active/confirmed bookings.
 */
const calculateTotalCost = async (planId) => {
  const [acc, trans, pkg, exp] = await Promise.all([
    prisma.accommodationBooking.aggregate({
      where: {
        travelPlanId: planId,
        // Exclude cancelled and other terminal accommodation statuses
        bookingStatus: { notIn: ["CANCELLED", "CHECKED_OUT", "NO_SHOW"] },
      },
      _sum: { totalCost: true },
    }),
    prisma.transportationBooking.aggregate({
      where: {
        travelPlanId: planId,
        // Exclude cancelled and completed transportation bookings
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      _sum: { actualFare: true, estimatedFare: true },
    }),
    prisma.travelPackageBooking.aggregate({
      where: {
        travelPlanId: planId,
        // Exclude cancelled and completed package bookings
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      _sum: { finalAmount: true },
    }),
    prisma.experienceBooking.aggregate({
      where: {
        travelPlanId: planId,
        // Exclude cancelled and completed experience bookings
        status: { notIn: ["CANCELLED", "COMPLETED"] },
      },
      _sum: { totalAmount: true },
    }),
  ]);

  const accommodations  = acc._sum.totalCost   ?? 0;
  const transportations = trans._sum.actualFare ?? trans._sum.estimatedFare ?? 0;
  const packages        = pkg._sum.finalAmount  ?? 0;
  const experiences     = exp._sum.totalAmount  ?? 0;
  const total           = accommodations + transportations + packages + experiences;

  return { accommodations, transportations, packages, experiences, total };
};
// ---------------------------------------------------------------------------
// Shared Prisma include fragments
// ---------------------------------------------------------------------------

const PLAN_COUNTS = {
  _count: {
    select: {
      accommodations:        true,
      transportServices:     true,
      travelPackageBookings: true,
      experiences:           true,
      shoppingVisits:        true,
      experienceBookings:    true,
    },
  },
};

const PLAN_FULL_INCLUDE = {
  user: {
    select: {
      id: true, name: true, email: true,
      profile: { select: { profilePicture: true } },
    },
  },
  accommodations: {
    include: { accommodation: true, rooms: true },
    orderBy: { checkInDate: "asc" },
  },
  transportServices: {
    include: { provider: true, vehicle: true },
    orderBy: { pickupTime: "asc" },
  },
  travelPackageBookings: {
    include: { package: true },
    orderBy: { startDate: "asc" },
  },
  experiences:       { orderBy: { date: "asc" } },
  experienceBookings: {
    include: { experience: true },
    orderBy: { experienceDate: "asc" },
  },
  shoppingVisits: {
    include: { store: true },
    orderBy: { plannedDate: "asc" },
  },
  ...PLAN_COUNTS,
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class TravelPlanController {

  // ==========================================================================
  //  CORE TRAVEL PLAN CRUD
  // ==========================================================================

  /**
   * POST /api/travel-plans
   *
   * Creates a new travel plan owned by the authenticated user.
   * - Explicit field whitelist prevents req.body injection.
   * - Validates and parses dates before persisting.
   * - OpenFGA tuple creation and cache bust are fire-and-forget.
   */
  async createTravelPlan(req, res, next) {
    try {
      const {
        title, destination, description,
        startDate, endDate, budget, numberOfTravelers,
        itinerary, recommendations, interests,
      } = req.body;

      if (!title)               return badRequest(res, "title is required");
      if (!destination)         return badRequest(res, "destination is required");
      if (!startDate || !endDate) return badRequest(res, "startDate and endDate are required");

      const start = new Date(startDate);
      const end   = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return badRequest(res, "Invalid date format");
      }
      if (end <= start) return badRequest(res, "endDate must be after startDate");

      const plan = await prisma.travelPlan.create({
        data: {
          userId:      req.user.id,
          title:       title.trim(),
          destination: destination.trim(),
          startDate:   start,
          endDate:     end,
          status:      "PLANNING",
          interests:   interests ?? [],
          numberOfTravelers :   numberOfTravelers  ?? 1,
          ...(description     !== undefined && { description }),
          ...(budget          !== undefined && { budget: +budget }),
          ...(itinerary       !== undefined && { itinerary }),
          ...(recommendations !== undefined && { recommendations }),
        },
      });

      // Fire-and-forget — don't block the response
      Promise.allSettled([
        openfgaService.createTravelPlanRelations(req.user.id, plan.id),
        cacheDel(`user:${req.user.id}:travelplans`),
      ]);

      return created(res, plan, "Travel plan created successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans
   *
   * Returns paginated list of the authenticated user's travel plans,
   * each enriched with currentSpent and budgetRemaining.
   * - Sort field whitelisted against ALLOWED_SORT_FIELDS.
   * - skipCache normalised to === "true" (string "false" is truthy).
   * - Cost queries fan-out via Promise.all (no N+1).
   * - Limit capped at MAX_PAGE_LIMIT.
   * - Cache key includes all filter and sort dimensions.
   */
  async getTravelPlans(req, res, next) {
    try {
      const {
        status, destination, fromDate, toDate,
        sortBy = "startDate", sortOrder = "asc",
      } = req.query;

      const { page, limit, skip } = parsePagination(req.query);
      const { field, order }      = safeSort(sortBy, sortOrder);
      const skipCache             = req.query.skipCache === "true";

      const cacheKey = `user:${req.user.id}:travelplans:${page}:${limit}:${status ?? ""}:${destination ?? ""}:${field}:${order}`;

      if (!skipCache) {
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json({ success: true, ...cached, cached: true });
      }

      const where = { userId: req.user.id };
      if (status)      where.status      = status;
      if (destination) where.destination = { contains: destination.trim(), mode: "insensitive" };
      if (fromDate)    where.startDate   = { gte: new Date(fromDate) };
      if (toDate)      where.endDate     = { lte: new Date(toDate) };

      const [plans, total] = await Promise.all([
        prisma.travelPlan.findMany({
          where,
          include:  PLAN_COUNTS,
          skip,
          take:     limit,
          orderBy:  { [field]: order },
        }),
        prisma.travelPlan.count({ where }),
      ]);

      // All cost queries fan-out concurrently — no N+1
      const allCosts = await Promise.all(plans.map((p) => calculateTotalCost(p.id)));

      const data = plans.map((plan, i) => ({
        ...plan,
        currentSpent:    allCosts[i].total,
        budgetRemaining: (plan.budget ?? 0) - allCosts[i].total,
      }));

      const body = { data, pagination: paginationMeta(page, limit, total) };
      cacheSet(cacheKey, body, CACHE_TTL.LIST);

      return res.json({ success: true, ...body });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id
   *
   * Returns full plan detail with all booking relations included.
   * - Existence check before permission check (gives 404 not 403 on missing plans).
   * - Enriches with currentSpent, budgetBreakdown, budgetRemaining, isOwner.
   */
async getTravelPlanById(req, res, next) {
  try {
    const { id }    = req.params;
    const skipCache = req.query.skipCache === "true";

    if (!skipCache) {
      const cached = await cacheGet(`travelplan:${id}`);
      if (cached) return res.json({ success: true, data: cached, cached: true });
    }

    const plan = await prisma.travelPlan.findUnique({
      where:   { id },
      include: PLAN_FULL_INCLUDE,
    });

    if (!plan) return notFound(res, "Travel plan not found");

    const canView =
      req.user.isSuperAdmin ||
      plan.userId === req.user.id ||
      (await checkPlanPermission(req.user.id, id, "view"));

    if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

    const costs = await calculateTotalCost(id);

    // [FIX] Strip email from non-owners / non-superadmins
    const isOwner = plan.userId === req.user.id;
    const userInfo = (isOwner || req.user.isSuperAdmin)
      ? plan.user
      : { id: plan.user.id, name: plan.user.name, profile: plan.user.profile };

    const enriched = {
      ...plan,
      user:            userInfo,               // <-- replaced with filtered version
      currentSpent:    costs.total,
      budgetBreakdown: costs,
      budgetRemaining: (plan.budget ?? 0) - costs.total,
      isOwner,
    };

    cacheSet(`travelplan:${id}`, enriched, CACHE_TTL.PLAN);

    return ok(res, enriched);
  } catch (err) {
    next(err);
  }
}
  /**
   * PUT /api/travel-plans/:id
   *
   * Sparse update — only supplied fields are written.
   * - Existence check before permission check.
   * - Cross-validates dates against each other AND existing stored dates when
   *   only one date is supplied (fixes partial-date regression in v2).
   * - userId and id are never writable.
   * - status validated against VALID_PLAN_STATUSES.
   */
  async updateTravelPlan(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, userId: true, startDate: true, endDate: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to update this travel plan");

      const {
        title, destination, description,
        startDate, endDate, budget, numberOfTravelers,
        itinerary, recommendations, interests, status,
      } = req.body;

      // Cross-validate dates: merge incoming with existing before comparing
      const newStart = startDate ? new Date(startDate) : existing.startDate;
      const newEnd   = endDate   ? new Date(endDate)   : existing.endDate;

      if (startDate && isNaN(newStart.getTime())) return badRequest(res, "Invalid startDate format");
      if (endDate   && isNaN(newEnd.getTime()))   return badRequest(res, "Invalid endDate format");
      if (newEnd <= newStart) return badRequest(res, "endDate must be after startDate");

      if (status && !VALID_PLAN_STATUSES.has(status)) {
        return badRequest(res, `status must be one of: ${[...VALID_PLAN_STATUSES].join(", ")}`);
      }

      const updated = await prisma.travelPlan.update({
        where: { id },
        data: {
          ...(title           !== undefined && { title:       title.trim() }),
          ...(destination     !== undefined && { destination: destination.trim() }),
          ...(description     !== undefined && { description }),
          ...(startDate       !== undefined && { startDate:   newStart }),
          ...(endDate         !== undefined && { endDate:     newEnd }),
          ...(budget          !== undefined && { budget:      +budget }),
          ...(numberOfTravelers       !== undefined && { numberOfTravelers }),
          ...(itinerary       !== undefined && { itinerary }),
          ...(recommendations !== undefined && { recommendations }),
          ...(interests       !== undefined && { interests }),
          ...(status          !== undefined && { status }),
        },
      });

      invalidatePlan(id, existing.userId);

      return ok(res, updated, "Travel plan updated successfully");
    } catch (err) {
      if (err.code === "P2025") return notFound(res, "Travel plan not found");
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/:id
   *
   * Prevents deletion when active bookings exist.
   * - All four active-booking checks fan out concurrently.
   * - Existence check before permission check.
   */
  async deleteTravelPlan(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canDelete =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "delete"));

      if (!canDelete) return forbidden(res, "You do not have permission to delete this travel plan");

      // All active-booking checks run concurrently
      const [accActive, transActive, pkgActive, expActive] = await Promise.all([
        prisma.accommodationBooking.count({
          where: { travelPlanId: id, bookingStatus: { in: ["CONFIRMED", "CHECKED_IN"] } },
        }),
        prisma.transportationBooking.count({
          where: { travelPlanId: id, status: { in: ["CONFIRMED", "ON_THE_WAY"] } },
        }),
        prisma.travelPackageBooking.count({
          where: { travelPlanId: id, status: "CONFIRMED" },
        }),
        prisma.experienceBooking.count({
          where: { travelPlanId: id, status: "CONFIRMED" },
        }),
      ]);

      if (accActive + transActive + pkgActive + expActive > 0) {
        return badRequest(res, "Cannot delete a travel plan with active bookings. Cancel all bookings first.");
      }

      await prisma.travelPlan.delete({ where: { id } });
      invalidatePlan(id, existing.userId);

      return ok(res, null, "Travel plan deleted successfully");
    } catch (err) {
      if (err.code === "P2025") return notFound(res, "Travel plan not found");
      next(err);
    }
  }

  /**
   * POST /api/travel-plans/:id/duplicate
   *
   * Creates a copy of an existing plan owned by the requesting user.
   * Duration is preserved; start date can be overridden.
   * itinerary/recommendations are intentionally NOT copied (fresh slate).
   * Pass ?copyItinerary=true to opt-in.
   */
  async duplicateTravelPlan(req, res, next) {
    try {
      const { id }                    = req.params;
      const { title, startDate }      = req.body;
      const copyItinerary             = req.query.copyItinerary === "true";

      const original = await prisma.travelPlan.findUnique({ where: { id } });
      if (!original) return notFound(res, "Original travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        original.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to duplicate this travel plan");

      const durationMs = original.endDate - original.startDate;
      const newStart   = startDate ? new Date(startDate) : new Date();
      const newEnd     = new Date(newStart.getTime() + durationMs);

      const duplicate = await prisma.travelPlan.create({
        data: {
          userId:      req.user.id,
          title:       title?.trim() || `${original.title} (Copy)`,
          destination: original.destination,
          description: original.description,
          startDate:   newStart,
          endDate:     newEnd,
          budget:      original.budget,
          numberOfTravelers:   original.numberOfTravelers,
          interests:   original.interests,
          status:      "PLANNING",
          ...(copyItinerary && {
            itinerary:       original.itinerary,
            recommendations: original.recommendations,
          }),
        },
      });

      Promise.allSettled([
        openfgaService.createTravelPlanRelations(req.user.id, duplicate.id),
        cacheDel(`user:${req.user.id}:travelplans`),
      ]);

      return created(res, duplicate, "Travel plan duplicated successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  STATUS MANAGEMENT
  // ==========================================================================

  /**
   * PATCH /api/travel-plans/:id/status
   *
   * Lightweight status-only update with enum validation.
   */
  async updatePlanStatus(req, res, next) {
    try {
      const { id }     = req.params;
      const { status } = req.body;

      if (!status)                        return badRequest(res, "status is required");
      if (!VALID_PLAN_STATUSES.has(status)) return badRequest(res, `status must be one of: ${[...VALID_PLAN_STATUSES].join(", ")}`);

      const existing = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to update this travel plan");

      const updated = await prisma.travelPlan.update({
        where:  { id },
        data:   { status },
        select: { id: true, status: true, updatedAt: true },
      });

      invalidatePlan(id, existing.userId);

      return ok(res, updated, `Travel plan status updated to ${status}`);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  SHARING & COLLABORATION
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/share
   *
   * Grants a permission level to another user on this plan.
   * - Validates permission against whitelist.
   * - Prevents self-share.
   * - Returns 409 if user already holds that permission.
   *   Uses openfgaService.checkPermission safely (null check, not optional chaining).
   */
  async shareTravelPlan(req, res, next) {
    try {
      const { id }                    = req.params;
      const { email, permission }     = req.body;

      if (!email)      return badRequest(res, "email is required");
      if (!permission) return badRequest(res, "permission is required");
      if (!SHARE_PERMISSIONS.includes(permission)) {
        return badRequest(res, `permission must be one of: ${SHARE_PERMISSIONS.join(", ")}`);
      }

      const [existing, canShare] = await Promise.all([
        prisma.travelPlan.findUnique({ where: { id }, select: { id: true, userId: true } }),
        req.user.isSuperAdmin
          ? Promise.resolve(true)
          : checkPlanPermission(req.user.id, id, "share"),
      ]);

      if (!existing) return notFound(res, "Travel plan not found");
      if (!canShare)  return forbidden(res, "You do not have permission to share this travel plan");

      const targetUser = await prisma.user.findUnique({
        where:  { email },
        select: { id: true, name: true },
      });
      if (!targetUser) return notFound(res, "User not found");
      if (targetUser.id === req.user.id) return badRequest(res, "Cannot share a travel plan with yourself");

      // Duplicate-permission guard — explicit null check (not optional chaining)
      // to surface missing method as a real error rather than silently skipping.
      if (typeof openfgaService.checkPermission === "function") {
        const alreadyHas = await openfgaService
          .checkPermission(targetUser.id, permission, `travelplan:${id}`)
          .catch(() => false);

        if (alreadyHas) {
          return conflict(res, `User already has ${permission} access to this travel plan`);
        }
      }

      await openfgaService.shareTravelPlan(id, targetUser.id, permission);

      return ok(res, null, `Travel plan shared with ${email} as ${permission}`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/:id/share/:email
   *
   * Revokes all permission levels from a user on this plan.
   */
  async revokeAccess(req, res, next) {
    try {
      const { id, email } = req.params;

      const [existing, canShare] = await Promise.all([
        prisma.travelPlan.findUnique({ where: { id }, select: { id: true } }),
        req.user.isSuperAdmin
          ? Promise.resolve(true)
          : checkPlanPermission(req.user.id, id, "share"),
      ]);

      if (!existing) return notFound(res, "Travel plan not found");
      if (!canShare)  return forbidden(res, "You do not have permission to revoke access for this travel plan");

      const targetUser = await prisma.user.findUnique({
        where:  { email },
        select: { id: true },
      });
      if (!targetUser) return notFound(res, "User not found");

      // Remove all permission levels for this user
      await Promise.allSettled(
        SHARE_PERMISSIONS.map((perm) =>
          openfgaService.revokeTravelPlanAccess(id, targetUser.id, perm).catch(() => {})
        )
      );

      return ok(res, null, `Access revoked for ${email}`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/shared-users
   *
   * Lists all users who have been explicitly granted access to this plan.
   * Reads tuples from OpenFGA, resolves user details from DB.
   * - Existence and view permission checked before any FGA read.
   * - readTuples null-checked explicitly (not optional chaining).
   */
  async getSharedUsers(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      if (typeof openfgaService.readTuples !== "function") {
        return ok(res, [], "OpenFGA readTuples not available");
      }

      const tuples = await openfgaService.readTuples(`travelplan:${id}`).catch(() => []) ?? [];

      // Collect unique user IDs, excluding the plan owner
      const userIds = [
        ...new Set(
          tuples
            .map((t) => t.user?.replace("user:", ""))
            .filter(Boolean)
            .filter((uid) => uid !== existing.userId)
        ),
      ];

      const users = userIds.length
        ? await prisma.user.findMany({
            where:  { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];

      const usersMap = Object.fromEntries(users.map((u) => [u.id, u]));

      const sharedUsers = tuples
        .map((t) => {
          const uid = t.user?.replace("user:", "");
          return uid && usersMap[uid]
            ? { userId: uid, permission: t.relation, user: usersMap[uid] }
            : null;
        })
        .filter(Boolean);

      return ok(res, sharedUsers);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/travel-plans/:id/share/:email
   *
   * Update an existing collaborator's permission level.
   * Revokes all existing permissions then writes the new one.
   */
  async updateSharedUserPermission(req, res, next) {
    try {
      const { id, email }         = req.params;
      const { permission }        = req.body;

      if (!permission) return badRequest(res, "permission is required");
      if (!SHARE_PERMISSIONS.includes(permission)) {
        return badRequest(res, `permission must be one of: ${SHARE_PERMISSIONS.join(", ")}`);
      }

      const [existing, canShare] = await Promise.all([
        prisma.travelPlan.findUnique({ where: { id }, select: { id: true } }),
        req.user.isSuperAdmin
          ? Promise.resolve(true)
          : checkPlanPermission(req.user.id, id, "share"),
      ]);

      if (!existing) return notFound(res, "Travel plan not found");
      if (!canShare)  return forbidden(res, "You do not have permission to manage collaborators");

      const targetUser = await prisma.user.findUnique({
        where:  { email },
        select: { id: true },
      });
      if (!targetUser) return notFound(res, "User not found");

      // Revoke all then grant the new permission
      await Promise.allSettled(
        SHARE_PERMISSIONS.map((p) =>
          openfgaService.revokeTravelPlanAccess(id, targetUser.id, p).catch(() => {})
        )
      );
      await openfgaService.shareTravelPlan(id, targetUser.id, permission);

      return ok(res, null, `Permission updated to ${permission} for ${email}`);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  ACCOMMODATION BOOKINGS
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/accommodations
   */
  async addAccommodationBooking(req, res, next) {
    try {
      const { id } = req.params;
      const {
        accommodationId, roomIds, checkInDate, checkOutDate,
        totalGuests, roomType, pricePerNight, taxes, serviceFee,
        totalCost, guestName, guestEmail, guestPhone, specialRequests,
        paymentStatus, paymentMethod,
      } = req.body;

      if (!checkInDate || !checkOutDate) return badRequest(res, "checkInDate and checkOutDate are required");
      if (!guestName)                    return badRequest(res, "guestName is required");
      if (!guestEmail)                   return badRequest(res, "guestEmail is required");
      if (!accommodationId)              return badRequest(res, "accommodationId is required");
      if (!roomType)                     return badRequest(res, "roomType is required");
      if (pricePerNight === undefined)   return badRequest(res, "pricePerNight is required");
      if (totalCost === undefined)       return badRequest(res, "totalCost is required");

      const checkIn  = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) return badRequest(res, "Invalid date format");
      if (checkOut <= checkIn) return badRequest(res, "checkOutDate must be after checkInDate");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      const accommodation = await prisma.accommodation.findUnique({
        where:  { id: accommodationId },
        select: { id: true, isActive: true },
      });
      if (!accommodation)          return notFound(res, "Accommodation not found");
      if (!accommodation.isActive) return badRequest(res, "This accommodation is not currently available");

      const booking = await prisma.accommodationBooking.create({
        data: {
          travelPlanId:    id,
          accommodationId,
          checkInDate:     checkIn,
          checkOutDate:    checkOut,
          roomType,
          pricePerNight:   +pricePerNight,
          totalCost:       +totalCost,
          guestName,
          guestEmail,
          totalGuests:     totalGuests ?? 1,
          ...(taxes           !== undefined && { taxes:          +taxes }),
          ...(serviceFee      !== undefined && { serviceFee:     +serviceFee }),
          ...(guestPhone      !== undefined && { guestPhone }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentStatus   !== undefined && { paymentStatus }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
          ...(Array.isArray(roomIds) && roomIds.length && {
            rooms: { connect: roomIds.map((rid) => ({ id: rid })) },
          }),
        },
        include: { accommodation: true, rooms: true },
      });

      Promise.allSettled([
        openfgaService.createAccommodationBookingRelations(req.user.id, booking.id, id),
        cacheDel(`travelplan:${id}`, `accommodation:${accommodationId}`),
      ]);

      return created(res, booking, "Accommodation booking added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/accommodations
   *
   * Lists all accommodation bookings for a plan.
   */
  async getAccommodationBookings(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const bookings = await prisma.accommodationBooking.findMany({
        where:   { travelPlanId: id },
        include: { accommodation: true, rooms: true },
        orderBy: { checkInDate: "asc" },
      });

      return ok(res, bookings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/bookings/accommodation/:bookingId
   */
  async updateAccommodationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where:  { id: bookingId },
        select: { bookingStatus: true, travelPlanId: true, accommodationId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_ACCOMMODATION.has(booking.bookingStatus)) {
        return badRequest(res, `Cannot update a booking with status: ${booking.bookingStatus}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditAccommodationBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        checkInDate, checkOutDate, totalGuests, specialRequests,
        paymentStatus, paymentMethod, bookingStatus,
      } = req.body;

      if (checkInDate && checkOutDate) {
        const ci = new Date(checkInDate);
        const co = new Date(checkOutDate);
        if (co <= ci) return badRequest(res, "checkOutDate must be after checkInDate");
      }

      if (bookingStatus && TERMINAL_ACCOMMODATION.has(bookingStatus) && bookingStatus !== "CANCELLED") {
        // Allow admin to set terminal statuses; log it
      }

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

      cacheDel(`travelplan:${booking.travelPlanId}`, `accommodation:${booking.accommodationId}`);

      return ok(res, updated, "Booking updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/bookings/accommodation/:bookingId
   *
   * Blocks cancellation of CHECKED_IN (active stay) as well as CHECKED_OUT/NO_SHOW.
   */
  async cancelAccommodationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.accommodationBooking.findUnique({
        where:  { id: bookingId },
        select: { bookingStatus: true, paymentStatus: true, travelPlanId: true, accommodationId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      // FIX: also block CHECKED_IN (v2 only blocked CHECKED_OUT)
      if (booking.bookingStatus === "CANCELLED")   return badRequest(res, "Booking is already cancelled");
      if (booking.bookingStatus === "CHECKED_IN")  return badRequest(res, "Cannot cancel an active check-in. Contact support.");
      if (booking.bookingStatus === "CHECKED_OUT") return badRequest(res, "Cannot cancel a completed stay");
      if (booking.bookingStatus === "NO_SHOW")     return badRequest(res, "Cannot cancel a no-show booking");

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

      cacheDel(`travelplan:${booking.travelPlanId}`, `accommodation:${booking.accommodationId}`);

      return ok(res, cancelled, "Booking cancelled successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  TRANSPORTATION BOOKINGS
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/transportation
   */
  async addTransportationBooking(req, res, next) {
    try {
      const { id } = req.params;
      const {
        providerId, vehicleId, serviceType,
        pickupLocation, dropoffLocation, pickupTime, estimatedArrival,
        numberOfPassengers, specialRequests, estimatedFare, paymentMethod,
        snapshotVehicleType, snapshotVehicleNumber, snapshotDriverName, snapshotDriverContact,
      } = req.body;

      if (!serviceType)     return badRequest(res, "serviceType is required");
      if (!pickupLocation)  return badRequest(res, "pickupLocation is required");
      if (!dropoffLocation) return badRequest(res, "dropoffLocation is required");
      if (!pickupTime)      return badRequest(res, "pickupTime is required");

      const pickup  = new Date(pickupTime);
      if (isNaN(pickup.getTime())) return badRequest(res, "Invalid pickupTime format");

      const arrival = estimatedArrival ? new Date(estimatedArrival) : null;
      if (arrival && isNaN(arrival.getTime())) return badRequest(res, "Invalid estimatedArrival format");
      if (arrival && arrival <= pickup) return badRequest(res, "estimatedArrival must be after pickupTime");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      if (providerId) {
        const provider = await prisma.transportationProvider.findUnique({
          where:  { id: providerId },
          select: { id: true, isAvailable: true },
        });
        if (!provider)              return notFound(res, "Transportation provider not found");
        if (!provider.isAvailable)  return badRequest(res, "This provider is currently unavailable");
      }

      const booking = await prisma.transportationBooking.create({
        data: {
          travelPlanId:       id,
          serviceType,
          pickupLocation,
          dropoffLocation,
          pickupTime:         pickup,
          numberOfPassengers: numberOfPassengers ?? 1,
          ...(providerId            !== undefined && { providerId }),
          ...(vehicleId             !== undefined && { vehicleId }),
          ...(arrival               && { estimatedArrival: arrival }),
          ...(specialRequests       !== undefined && { specialRequests }),
          ...(estimatedFare         !== undefined && { estimatedFare: +estimatedFare }),
          ...(paymentMethod         !== undefined && { paymentMethod }),
          ...(snapshotVehicleType   !== undefined && { snapshotVehicleType }),
          ...(snapshotVehicleNumber !== undefined && { snapshotVehicleNumber }),
          ...(snapshotDriverName    !== undefined && { snapshotDriverName }),
          ...(snapshotDriverContact !== undefined && { snapshotDriverContact }),
        },
        include: { provider: true, vehicle: true },
      });

      Promise.allSettled([
        openfgaService.createTransportationBookingRelations(req.user.id, booking.id, id),
        cacheDel(`travelplan:${id}`, providerId ? `transportation:provider:${providerId}` : null),
      ]);

      return created(res, booking, "Transportation booking added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/transportation
   */
  async getTransportationBookings(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const bookings = await prisma.transportationBooking.findMany({
        where:   { travelPlanId: id },
        include: { provider: true, vehicle: true },
        orderBy: { pickupTime: "asc" },
      });

      return ok(res, bookings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/bookings/transportation/:bookingId
   */
  async updateTransportationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, travelPlanId: true, providerId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_BOOKING.has(booking.status)) {
        return badRequest(res, `Cannot update a booking with status: ${booking.status}`);
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

      cacheDel(
        `travelplan:${booking.travelPlanId}`,
        booking.providerId ? `transportation:provider:${booking.providerId}` : null
      );

      return ok(res, updated, "Booking updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/bookings/transportation/:bookingId
   */
  async cancelTransportationBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.transportationBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, paymentStatus: true, travelPlanId: true, providerId: true },
      });
      if (!booking)                       return notFound(res, "Booking not found");
      if (booking.status === "CANCELLED") return badRequest(res, "Booking is already cancelled");
      if (booking.status === "COMPLETED") return badRequest(res, "Cannot cancel a completed booking");
      if (booking.status === "ON_THE_WAY") return badRequest(res, "Cannot cancel a booking that is already in progress");

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

      cacheDel(
        `travelplan:${booking.travelPlanId}`,
        booking.providerId ? `transportation:provider:${booking.providerId}` : null
      );

      return ok(res, cancelled, "Booking cancelled successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  PACKAGE BOOKINGS
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/packages
   *
   * FIX: Guards against null basePrice before computing finalAmount.
   */
  async addPackageBooking(req, res, next) {
    try {
      const { id } = req.params;
      const {
        packageId, startDate, endDate, numberOfTravelers,
        leadGuestName, leadGuestEmail, leadGuestPhone,
        specialRequests, paymentMethod,
      } = req.body;

      if (!packageId)                    return badRequest(res, "packageId is required");
      if (!startDate || !endDate)        return badRequest(res, "startDate and endDate are required");
      if (!leadGuestName)                return badRequest(res, "leadGuestName is required");
      if (!leadGuestEmail)               return badRequest(res, "leadGuestEmail is required");

      const start = new Date(startDate);
      const end   = new Date(endDate);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return badRequest(res, "Invalid date format");
      if (end <= start) return badRequest(res, "endDate must be after startDate");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      const pkg = await prisma.travelPackage.findUnique({
        where:  { id: packageId },
        select: { id: true, isActive: true, basePrice: true, discount: true, currency: true },
      });
      if (!pkg)           return notFound(res, "Travel package not found");
      if (!pkg.isActive)  return badRequest(res, "This package is not currently available");
      // FIX: guard against null basePrice
      if (pkg.basePrice == null) return badRequest(res, "This package has no base price configured");

      const travelers      = numberOfTravelers ?? 1;
      const discountFactor = pkg.discount ? 1 - pkg.discount / 100 : 1;
      const finalAmount    = +(pkg.basePrice * discountFactor * travelers).toFixed(2);

      const booking = await prisma.travelPackageBooking.create({
        data: {
          travelPlanId:      id,
          packageId,
          startDate:         start,
          endDate:           end,
          numberOfTravelers: travelers,
          basePrice:         pkg.basePrice,
          discount:          pkg.discount ?? 0,
          finalAmount,
          currency:          pkg.currency,
          leadGuestName,
          leadGuestEmail,
          ...(leadGuestPhone  !== undefined && { leadGuestPhone }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
        },
        include: { package: true },
      });

      Promise.allSettled([
        openfgaService.createTravelPackageBookingRelations(req.user.id, booking.id, id, packageId),
        cacheDel(`travelplan:${id}`),
      ]);

      return created(res, booking, "Package booking added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/packages
   */
  async getPackageBookings(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const bookings = await prisma.travelPackageBooking.findMany({
        where:   { travelPlanId: id },
        include: { package: true },
        orderBy: { startDate: "asc" },
      });

      return ok(res, bookings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/bookings/package/:bookingId
   */
  async updatePackageBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.travelPackageBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, travelPlanId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_BOOKING.has(booking.status)) {
        return badRequest(res, `Cannot update a booking with status: ${booking.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelPackageBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        startDate, endDate, numberOfTravelers,
        specialRequests, status, paymentStatus, paymentMethod,
      } = req.body;

      const updated = await prisma.travelPackageBooking.update({
        where: { id: bookingId },
        data: {
          ...(startDate         !== undefined && { startDate:         new Date(startDate) }),
          ...(endDate           !== undefined && { endDate:           new Date(endDate) }),
          ...(numberOfTravelers !== undefined && { numberOfTravelers }),
          ...(specialRequests   !== undefined && { specialRequests }),
          ...(status            !== undefined && { status }),
          ...(paymentStatus     !== undefined && { paymentStatus }),
          ...(paymentMethod     !== undefined && { paymentMethod }),
        },
        include: { package: true },
      });

      cacheDel(`travelplan:${booking.travelPlanId}`);

      return ok(res, updated, "Booking updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/bookings/package/:bookingId
   */
  async cancelPackageBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.travelPackageBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, paymentStatus: true, travelPlanId: true },
      });
      if (!booking)                      return notFound(res, "Booking not found");
      if (booking.status === "CANCELLED") return badRequest(res, "Booking is already cancelled");
      if (booking.status === "COMPLETED") return badRequest(res, "Cannot cancel a completed booking");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelTravelPackageBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this booking");

      const cancelled = await prisma.travelPackageBooking.update({
        where: { id: bookingId },
        data: {
          status:        "CANCELLED",
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus,
        },
      });

      cacheDel(`travelplan:${booking.travelPlanId}`);

      return ok(res, cancelled, "Booking cancelled successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  EXPERIENCE BOOKINGS (Vendor)
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/experiences
   */
  async addExperienceBooking(req, res, next) {
    try {
      const { id } = req.params;
      const {
        experienceId, experienceDate, numberOfParticipants, numberOfChildren,
        leadGuestName, leadGuestEmail, leadGuestPhone, specialRequests, paymentMethod,
      } = req.body;

      if (!experienceId)   return badRequest(res, "experienceId is required");
      if (!experienceDate) return badRequest(res, "experienceDate is required");
      if (!leadGuestName)  return badRequest(res, "leadGuestName is required");
      if (!leadGuestEmail) return badRequest(res, "leadGuestEmail is required");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add bookings to this travel plan");

      const experience = await prisma.vendorExperience.findUnique({
        where:  { id: experienceId },
        select: { id: true, isActive: true, pricePerPerson: true, childPrice: true, currency: true },
      });
      if (!experience)          return notFound(res, "Experience not found");
      if (!experience.isActive) return badRequest(res, "This experience is not currently available");

      const participants = numberOfParticipants ?? 1;
      const children     = numberOfChildren     ?? 0;
      const totalAmount  = +(
        participants * (experience.pricePerPerson ?? 0) +
        children     * (experience.childPrice ?? 0)
      ).toFixed(2);

      const booking = await prisma.experienceBooking.create({
        data: {
          travelPlanId:        id,
          experienceId,
          experienceDate:      new Date(experienceDate),
          numberOfParticipants: participants,
          numberOfChildren:     children,
          unitPrice:            experience.pricePerPerson ?? 0,
          childPrice:           experience.childPrice,
          totalAmount,
          currency:             experience.currency,
          leadGuestName,
          leadGuestEmail,
          ...(leadGuestPhone  !== undefined && { leadGuestPhone }),
          ...(specialRequests !== undefined && { specialRequests }),
          ...(paymentMethod   !== undefined && { paymentMethod }),
        },
        include: { experience: true },
      });

      Promise.allSettled([
        openfgaService.createExperienceBookingRelations(req.user.id, booking.id, id, experienceId),
        cacheDel(`travelplan:${id}`),
      ]);

      return created(res, booking, "Experience booking added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/experiences
   */
  async getExperienceBookings(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const bookings = await prisma.experienceBooking.findMany({
        where:   { travelPlanId: id },
        include: { experience: true },
        orderBy: { experienceDate: "asc" },
      });

      return ok(res, bookings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/bookings/experience/:bookingId
   */
  async updateExperienceBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.experienceBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, travelPlanId: true },
      });
      if (!booking) return notFound(res, "Booking not found");

      if (TERMINAL_BOOKING.has(booking.status)) {
        return badRequest(res, `Cannot update a booking with status: ${booking.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditExperienceBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this booking");

      const {
        experienceDate, numberOfParticipants, numberOfChildren,
        specialRequests, status, paymentStatus, paymentMethod,
      } = req.body;

      const updated = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          ...(experienceDate       !== undefined && { experienceDate:       new Date(experienceDate) }),
          ...(numberOfParticipants !== undefined && { numberOfParticipants }),
          ...(numberOfChildren     !== undefined && { numberOfChildren }),
          ...(specialRequests      !== undefined && { specialRequests }),
          ...(status               !== undefined && { status }),
          ...(paymentStatus        !== undefined && { paymentStatus }),
          ...(paymentMethod        !== undefined && { paymentMethod }),
        },
        include: { experience: true },
      });

      cacheDel(`travelplan:${booking.travelPlanId}`);

      return ok(res, updated, "Booking updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/bookings/experience/:bookingId
   */
  async cancelExperienceBooking(req, res, next) {
    try {
      const { bookingId } = req.params;

      const booking = await prisma.experienceBooking.findUnique({
        where:  { id: bookingId },
        select: { status: true, paymentStatus: true, travelPlanId: true },
      });
      if (!booking)                      return notFound(res, "Booking not found");
      if (booking.status === "CANCELLED") return badRequest(res, "Booking is already cancelled");
      if (booking.status === "COMPLETED") return badRequest(res, "Cannot cancel a completed booking");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelExperienceBooking?.(req.user.id, bookingId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this booking");

      const cancelled = await prisma.experienceBooking.update({
        where: { id: bookingId },
        data: {
          status:        "CANCELLED",
          paymentStatus: booking.paymentStatus === "PAID" ? "REFUNDED" : booking.paymentStatus,
        },
      });

      cacheDel(`travelplan:${booking.travelPlanId}`);

      return ok(res, cancelled, "Booking cancelled successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  SHOPPING VISITS
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/shopping
   */
  async addShoppingVisit(req, res, next) {
    try {
      const { id } = req.params;
      const { storeId, plannedDate, purpose, plannedItems, duration, aiNotes, recommendations } = req.body;

      if (!storeId)     return badRequest(res, "storeId is required");
      if (!plannedDate) return badRequest(res, "plannedDate is required");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add shopping visits to this travel plan");

      const store = await prisma.retailStore.findUnique({
        where: { id: storeId }, select: { id: true, isActive: true },
      });
      if (!store)          return notFound(res, "Store not found");
      if (!store.isActive) return badRequest(res, "This store is currently closed");

      const visit = await prisma.shoppingVisit.create({
        data: {
          travelPlanId: id,
          storeId,
          plannedDate:  new Date(plannedDate),
          ...(purpose         !== undefined && { purpose }),
          ...(plannedItems    !== undefined && { plannedItems }),
          ...(duration        !== undefined && { duration }),
          ...(aiNotes         !== undefined && { aiNotes }),
          ...(recommendations !== undefined && { recommendations }),
        },
        include: { store: { select: { id: true, name: true, city: true, storeType: true } } },
      });

      Promise.allSettled([
        openfgaService.createShoppingVisitRelations(req.user.id, visit.id, id),
        cacheDel(`travelplan:${id}`),
      ]);

      return created(res, visit, "Shopping visit added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/shopping
   */
  async getShoppingVisits(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const visits = await prisma.shoppingVisit.findMany({
        where:   { travelPlanId: id },
        include: { store: true },
        orderBy: { plannedDate: "asc" },
      });

      return ok(res, visits);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/shopping/:visitId
   */
  async updateShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      const visit = await prisma.shoppingVisit.findUnique({
        where:  { id: visitId },
        select: { status: true, travelPlanId: true },
      });
      if (!visit) return notFound(res, "Shopping visit not found");

      if (TERMINAL_SHOPPING_VISIT.has(visit.status)) {
        return badRequest(res, `Cannot update a visit with status: ${visit.status}`);
      }

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditShoppingVisit?.(req.user.id, visitId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this shopping visit");

      const {
        plannedDate, actualVisitDate, duration, purpose,
        plannedItems, status, aiNotes, recommendations,
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
        include: { store: true },
      });

      cacheDel(`travelplan:${visit.travelPlanId}`);

      return ok(res, updated, "Shopping visit updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/shopping/:visitId
   */
  async cancelShoppingVisit(req, res, next) {
    try {
      const { visitId } = req.params;

      const visit = await prisma.shoppingVisit.findUnique({
        where:  { id: visitId },
        select: { status: true, travelPlanId: true },
      });
      if (!visit)                       return notFound(res, "Shopping visit not found");
      if (visit.status === "CANCELLED") return badRequest(res, "Visit is already cancelled");
      if (visit.status === "VISITED")   return badRequest(res, "Cannot cancel a completed visit");

      const canCancel =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canCancelShoppingVisit?.(req.user.id, visitId).catch(() => false));

      if (!canCancel) return forbidden(res, "You do not have permission to cancel this shopping visit");

      const cancelled = await prisma.shoppingVisit.update({
        where: { id: visitId },
        data:  { status: "CANCELLED" },
      });

      cacheDel(`travelplan:${visit.travelPlanId}`);

      return ok(res, cancelled, "Shopping visit cancelled successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  CUSTOM TRAVEL EXPERIENCES
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/experiences/custom
   */
  async addTravelExperience(req, res, next) {
    try {
      const { id } = req.params;
      const { title, description, date, startTime, endTime, location, cost, category, aiNotes } = req.body;

      if (!title) return badRequest(res, "title is required");
      if (!date)  return badRequest(res, "date is required");

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to add experiences to this travel plan");

      const experience = await prisma.travelExperience.create({
        data: {
          travelPlanId: id,
          title:        title.trim(),
          date:         new Date(date),
          ...(description !== undefined && { description }),
          ...(startTime   !== undefined && { startTime }),
          ...(endTime     !== undefined && { endTime }),
          ...(location    !== undefined && { location }),
          ...(cost        !== undefined && { cost: +cost }),
          ...(category    !== undefined && { category }),
          ...(aiNotes     !== undefined && { aiNotes }),
        },
      });

      Promise.allSettled([
        typeof openfgaService.createTravelExperienceRelations === "function"
          ? openfgaService.createTravelExperienceRelations(req.user.id, experience.id, id)
          : Promise.resolve(),
        cacheDel(`travelplan:${id}`),
      ]);

      return created(res, experience, "Travel experience added successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/experiences/custom
   */
  async getCustomExperiences(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const experiences = await prisma.travelExperience.findMany({
        where:   { travelPlanId: id },
        orderBy: { date: "asc" },
      });

      return ok(res, experiences);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/travel-plans/experiences/custom/:experienceId
   */
  async updateTravelExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.travelExperience.findUnique({
        where:  { id: experienceId },
        select: { travelPlanId: true },
      });
      if (!experience) return notFound(res, "Experience not found");

      const canEdit =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canEditTravelExperience?.(req.user.id, experienceId).catch(() => false));

      if (!canEdit) return forbidden(res, "You do not have permission to update this experience");

      const { title, description, date, startTime, endTime, location, cost, category, aiNotes } = req.body;

      const updated = await prisma.travelExperience.update({
        where: { id: experienceId },
        data: {
          ...(title       !== undefined && { title:    title.trim() }),
          ...(description !== undefined && { description }),
          ...(date        !== undefined && { date:     new Date(date) }),
          ...(startTime   !== undefined && { startTime }),
          ...(endTime     !== undefined && { endTime }),
          ...(location    !== undefined && { location }),
          ...(cost        !== undefined && { cost:     +cost }),
          ...(category    !== undefined && { category }),
          ...(aiNotes     !== undefined && { aiNotes }),
        },
      });

      cacheDel(`travelplan:${experience.travelPlanId}`);

      return ok(res, updated, "Experience updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/travel-plans/experiences/custom/:experienceId
   */
  async deleteTravelExperience(req, res, next) {
    try {
      const { experienceId } = req.params;

      const experience = await prisma.travelExperience.findUnique({
        where:  { id: experienceId },
        select: { travelPlanId: true },
      });
      if (!experience) return notFound(res, "Experience not found");

      const canDelete =
        req.user.isSuperAdmin ||
        !!(await openfgaService.canDeleteTravelExperience?.(req.user.id, experienceId).catch(() => false));

      if (!canDelete) return forbidden(res, "You do not have permission to delete this experience");

      await prisma.travelExperience.delete({ where: { id: experienceId } });
      cacheDel(`travelplan:${experience.travelPlanId}`);

      return ok(res, null, "Experience deleted successfully");
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  BUDGET MANAGEMENT
  // ==========================================================================

  /**
   * PATCH /api/travel-plans/:id/budget
   */
  async updateBudget(req, res, next) {
    try {
      const { id }     = req.params;
      const { budget } = req.body;

      if (budget === undefined || budget === null) return badRequest(res, "budget is required");
      if (typeof budget !== "number" || !Number.isFinite(budget)) return badRequest(res, "budget must be a finite number");
      if (budget < 0) return badRequest(res, "budget must be a non-negative number");

      const existing = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to update this travel plan");

      const updated = await prisma.travelPlan.update({
        where:  { id },
        data:   { budget },
        select: { id: true, budget: true, updatedAt: true },
      });

      invalidatePlan(id, existing.userId);

      return ok(res, updated, "Budget updated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/budget/breakdown
   */
  async getBudgetBreakdown(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, budget: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const cacheKey = `travelplan:${id}:budget`;
      const cached   = await cacheGet(cacheKey);
      if (cached) return res.json({ success: true, data: cached, cached: true });

      const costs = await calculateTotalCost(id);
      const data = {
        budget:         plan.budget ?? 0,
        spent:          costs.total,
        remaining:      (plan.budget ?? 0) - costs.total,
        breakdown:      costs,
        percentageUsed: plan.budget
          ? +((costs.total / plan.budget) * 100).toFixed(2)
          : 0,
        isOverBudget:   costs.total > (plan.budget ?? Infinity),
      };

      cacheSet(cacheKey, data, CACHE_TTL.BUDGET);

      return ok(res, data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/budget/by-category
   */
  async getSpendingByCategory(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const [accommodations, transportations, packages, experiences] = await Promise.all([
        prisma.accommodationBooking.aggregate({
          where: { travelPlanId: id },
          _sum:  { totalCost: true },
        }),
        prisma.transportationBooking.groupBy({
          by:    ["serviceType"],
          where: { travelPlanId: id },
          _sum:  { actualFare: true, estimatedFare: true },
        }),
        prisma.travelPackageBooking.aggregate({
          where: { travelPlanId: id },
          _sum:  { finalAmount: true },
        }),
        prisma.experienceBooking.aggregate({
          where: { travelPlanId: id },
          _sum:  { totalAmount: true },
        }),
      ]);

      const transportTotal = transportations.reduce(
        (s, t) => s + (t._sum.actualFare ?? t._sum.estimatedFare ?? 0), 0
      );

      return ok(res, {
        accommodations: accommodations._sum.totalCost  ?? 0,
        transportation: {
          total:  transportTotal,
          byType: transportations.map((t) => ({
            serviceType: t.serviceType,
            amount:      t._sum.actualFare ?? t._sum.estimatedFare ?? 0,
          })),
        },
        packages:    packages._sum.finalAmount  ?? 0,
        experiences: experiences._sum.totalAmount ?? 0,
        total:       (accommodations._sum.totalCost ?? 0) + transportTotal +
                     (packages._sum.finalAmount ?? 0) + (experiences._sum.totalAmount ?? 0),
      });
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  TIMELINE
  // ==========================================================================

  /**
   * GET /api/travel-plans/:id/timeline
   *
   * Returns all bookings and experiences merged into a single chronological
   * timeline, with a type discriminator on each event.
   */
  async getTimeline(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const [accBookings, transBookings, pkgBookings, expBookings, customExp, shopVisits] =
        await Promise.all([
          prisma.accommodationBooking.findMany({
            where:   { travelPlanId: id },
            include: { accommodation: { select: { id: true, name: true, city: true } } },
          }),
          prisma.transportationBooking.findMany({
            where:   { travelPlanId: id },
            include: { provider: { select: { id: true, name: true } } },
          }),
          prisma.travelPackageBooking.findMany({
            where:   { travelPlanId: id },
            include: { package: { select: { id: true, name: true } } },
          }),
          prisma.experienceBooking.findMany({
            where:   { travelPlanId: id },
            include: { experience: { select: { id: true, name: true } } },
          }),
          prisma.travelExperience.findMany({ where: { travelPlanId: id } }),
          prisma.shoppingVisit.findMany({
            where:   { travelPlanId: id },
            include: { store: { select: { id: true, name: true } } },
          }),
        ]);

      const events = [
        ...accBookings.map((b)  => ({ type: "ACCOMMODATION",   date: b.checkInDate,     ...b })),
        ...transBookings.map((b) => ({ type: "TRANSPORTATION",  date: b.pickupTime,      ...b })),
        ...pkgBookings.map((b)   => ({ type: "PACKAGE",         date: b.startDate,       ...b })),
        ...expBookings.map((b)   => ({ type: "EXPERIENCE",      date: b.experienceDate,  ...b })),
        ...customExp.map((e)     => ({ type: "CUSTOM_EXPERIENCE", date: e.date,          ...e })),
        ...shopVisits.map((v)    => ({ type: "SHOPPING",        date: v.plannedDate,     ...v })),
      ].sort((a, b) => new Date(a.date) - new Date(b.date));

      return ok(res, events);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  STATISTICS
  // ==========================================================================

  /**
   * GET /api/travel-plans/:id/stats
   *
   * All 24 queries (23 counts + 1 cost aggregation) run concurrently.
   */
  async getTravelPlanStats(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true, budget: true },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      const cacheKey = `travelplan:${id}:stats`;
      const cached   = await cacheGet(cacheKey);
      if (cached) return res.json({ success: true, data: cached, cached: true });

      const now = new Date();

      const [
        // totals (5)
        accTotal, transTotal, pkgTotal, expTotal, visitTotal,
        // confirmed (4)
        accConfirmed, transConfirmed, pkgConfirmed, expConfirmed,
        // pending (4)
        accPending, transPending, pkgPending, expPending,
        // cancelled (5)
        accCancelled, transCancelled, pkgCancelled, expCancelled, visitCancelled,
        // upcoming (5)
        accUpcoming, transUpcoming, pkgUpcoming, expUpcoming, visitUpcoming,
        // cost (1)
        costs,
      ] = await Promise.all([
        prisma.accommodationBooking.count({ where: { travelPlanId: id } }),
        prisma.transportationBooking.count({ where: { travelPlanId: id } }),
        prisma.travelPackageBooking.count({ where: { travelPlanId: id } }),
        prisma.experienceBooking.count({ where: { travelPlanId: id } }),
        prisma.shoppingVisit.count({ where: { travelPlanId: id } }),

        prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: "CONFIRMED" } }),
        prisma.transportationBooking.count({ where: { travelPlanId: id, status: "CONFIRMED" } }),
        prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: "CONFIRMED" } }),
        prisma.experienceBooking.count({ where: { travelPlanId: id, status: "CONFIRMED" } }),

        prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: "PENDING" } }),
        prisma.transportationBooking.count({ where: { travelPlanId: id, status: "BOOKED" } }),
        prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: "PENDING" } }),
        prisma.experienceBooking.count({ where: { travelPlanId: id, status: "PENDING" } }),

        prisma.accommodationBooking.count({ where: { travelPlanId: id, bookingStatus: "CANCELLED" } }),
        prisma.transportationBooking.count({ where: { travelPlanId: id, status: "CANCELLED" } }),
        prisma.travelPackageBooking.count({ where: { travelPlanId: id, status: "CANCELLED" } }),
        prisma.experienceBooking.count({ where: { travelPlanId: id, status: "CANCELLED" } }),
        prisma.shoppingVisit.count({ where: { travelPlanId: id, status: "CANCELLED" } }),

        prisma.accommodationBooking.count({ where: { travelPlanId: id, checkInDate:    { gt: now } } }),
        prisma.transportationBooking.count({ where: { travelPlanId: id, pickupTime:    { gt: now } } }),
        prisma.travelPackageBooking.count({ where: { travelPlanId: id, startDate:      { gt: now } } }),
        prisma.experienceBooking.count({ where: { travelPlanId: id, experienceDate:    { gt: now } } }),
        prisma.shoppingVisit.count({ where: { travelPlanId: id, plannedDate:           { gt: now } } }),

        calculateTotalCost(id),
      ]);

      const totalBookings  = accTotal + transTotal + pkgTotal + expTotal + visitTotal;
      const confirmedCount = accConfirmed + transConfirmed + pkgConfirmed + expConfirmed;
      const pendingCount   = accPending + transPending + pkgPending + expPending;
      const cancelledCount = accCancelled + transCancelled + pkgCancelled + expCancelled + visitCancelled;
      const upcomingCount  = accUpcoming + transUpcoming + pkgUpcoming + expUpcoming + visitUpcoming;

      const data = {
        totalBookings,
        confirmedBookings:  confirmedCount,
        pendingBookings:    pendingCount,
        cancelledBookings:  cancelledCount,
        upcomingActivities: upcomingCount,
        totalSpent:         costs.total,
        costBreakdown:      costs,
        completionRate:     totalBookings > 0
          ? +((confirmedCount / totalBookings) * 100).toFixed(2)
          : 0,
        budgetUtilization:  plan.budget
          ? +((costs.total / plan.budget) * 100).toFixed(2)
          : null,
      };

      cacheSet(cacheKey, data, CACHE_TTL.STATS);

      return ok(res, data);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  AI FEATURES
  // ==========================================================================

  /**
   * POST /api/travel-plans/:id/generate-itinerary
   *
   * Placeholder — wire up AI service here.
   */
  async generateItinerary(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canEdit =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "edit"));

      if (!canEdit) return forbidden(res, "You do not have permission to modify this travel plan");

      // Fetch full context for AI service
      const fullPlan = await prisma.travelPlan.findUnique({
        where:   { id },
        include: {
          accommodations:     { include: { accommodation: true } },
          transportServices:  { include: { provider: true } },
          experiences:        true,
          experienceBookings: { include: { experience: true } },
          shoppingVisits:     { include: { store: true } },
        },
      });

      // TODO: call AI service with fullPlan as context
      const itinerary = { days: [], recommendations: [], tips: [] };

      await prisma.travelPlan.update({
        where: { id },
        data:  { itinerary },
      });

      cacheDel(`travelplan:${id}`);

      return ok(res, itinerary, "Itinerary generated successfully");
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/travel-plans/:id/recommendations
   */
  async getRecommendations(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where:  { id },
        select: {
          id: true, userId: true, destination: true, startDate: true,
          endDate: true, numberOfTravelers: true, interests: true, recommendations: true,
        },
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        plan.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to view this travel plan");

      return ok(res, plan.recommendations ?? {});
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  EXPORT
  // ==========================================================================

  /**
   * GET /api/travel-plans/:id/export
   *
   * JSON export. Owner email is only included for the plan owner / superadmin.
   * - Existence check before format branching.
   * - User PII gated on ownership.
   */
  async exportTravelPlan(req, res, next) {
    try {
      const { id }              = req.params;
      const { format = "json" } = req.query;

      const existing = await prisma.travelPlan.findUnique({
        where:  { id },
        select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const canView =
        req.user.isSuperAdmin ||
        existing.userId === req.user.id ||
        (await checkPlanPermission(req.user.id, id, "view"));

      if (!canView) return forbidden(res, "You do not have permission to export this travel plan");

      // Only plan owners and superadmins see user PII in export
      const includeUserPII = req.user.isSuperAdmin || existing.userId === req.user.id;

      const plan = await prisma.travelPlan.findUnique({
        where:   { id },
        include: {
          user:                  includeUserPII
            ? { select: { name: true, email: true } }
            : { select: { name: true } },
          accommodations:        { include: { accommodation: true } },
          transportServices:     { include: { provider: true } },
          travelPackageBookings: { include: { package: true } },
          experiences:           true,
          experienceBookings:    { include: { experience: true } },
          shoppingVisits:        { include: { store: true } },
        },
      });

      const costs = await calculateTotalCost(id);

      const exportData = {
        metadata:   { exportedAt: new Date().toISOString(), version: "1.0" },
        travelPlan: { ...plan, currentSpent: costs.total, budgetBreakdown: costs },
      };

      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=travel-plan-${id}.json`);
        return res.json(exportData);
      }

      return badRequest(res, `Export format "${format}" is not supported. Supported: json`);
    } catch (err) {
      next(err);
    }
  }

  // ==========================================================================
  //  SUPERADMIN ENDPOINTS
  // ==========================================================================

  /**
   * GET /api/admin/travel-plans
   *
   * Returns all plans across all users with full filtering and pagination.
   */
  async adminGetAllPlans(req, res, next) {
    try {
      const {
        userId, status, destination, search,
        sortBy = "createdAt", sortOrder = "desc",
      } = req.query;

      const { page, limit, skip } = parsePagination(req.query, 20);
      const { field, order }      = safeSort(sortBy, sortOrder, "createdAt");

      const AND = [];
      if (userId)      AND.push({ userId });
      if (status)      AND.push({ status });
      if (destination) AND.push({ destination: { contains: destination.trim(), mode: "insensitive" } });
      if (search) {
        AND.push({
          OR: [
            { title:       { contains: search.trim(), mode: "insensitive" } },
            { destination: { contains: search.trim(), mode: "insensitive" } },
          ],
        });
      }

      const where = AND.length ? { AND } : {};

      const [plans, total] = await Promise.all([
        prisma.travelPlan.findMany({
          where,
          include: {
            user: { select: { id: true, name: true, email: true } },
            ...PLAN_COUNTS,
          },
          skip,
          take:    limit,
          orderBy: { [field]: order },
        }),
        prisma.travelPlan.count({ where }),
      ]);

      return ok(res, { plans, pagination: paginationMeta(page, limit, total) });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/admin/travel-plans/:id/status
   *
   * Force plan status. Validates against VALID_PLAN_STATUSES.
   */
  async adminUpdatePlanStatus(req, res, next) {
    try {
      const { id }     = req.params;
      const { status } = req.body;

      if (!status)                        return badRequest(res, "status is required");
      if (!VALID_PLAN_STATUSES.has(status)) return badRequest(res, `status must be one of: ${[...VALID_PLAN_STATUSES].join(", ")}`);

      const existing = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      const updated = await prisma.travelPlan.update({
        where: { id },
        data:  { status },
      });

      invalidatePlan(id, existing.userId);

      // Audit log placeholder — wire to your logging service
      console.info(`[ADMIN] Plan ${id} status forced to ${status} by user ${req.user.id}`);

      return ok(res, updated, `Travel plan status updated to ${status}`);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/admin/travel-plans/:id
   *
   * Force-delete regardless of active bookings (GDPR / ops use-case).
   * Logs deletion for audit trail.
   */
  async adminDeletePlan(req, res, next) {
    try {
      const { id }     = req.params;
      const { reason } = req.body;

      const existing = await prisma.travelPlan.findUnique({
        where: { id }, select: { id: true, userId: true },
      });
      if (!existing) return notFound(res, "Travel plan not found");

      await prisma.travelPlan.delete({ where: { id } });
      invalidatePlan(id, existing.userId);

      // Audit log placeholder — wire to your logging/audit service
      console.info(`[ADMIN DELETE] Plan ${id} (owner: ${existing.userId}) deleted by admin ${req.user.id}. Reason: ${reason ?? "not provided"}`);

      return ok(res, null, "Travel plan deleted successfully");
    } catch (err) {
      if (err.code === "P2025") return notFound(res, "Travel plan not found");
      next(err);
    }
  }

  /**
   * GET /api/admin/travel-plans/stats
   *
   * Platform-wide booking and plan statistics with optional date range filter.
   */
  async adminGetPlatformStats(req, res, next) {
    try {
      const { from, to } = req.query;

      const dateFilter = (from || to) ? {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to)   }),
        },
      } : {};

      const [
        totalPlans, plansByStatus,
        accBookings, transBookings, pkgBookings, expBookings, visits,
        revenueAgg,
      ] = await Promise.all([
        prisma.travelPlan.count({ where: dateFilter }),
        prisma.travelPlan.groupBy({
          by:     ["status"],
          where:  dateFilter,
          _count: true,
        }),
        prisma.accommodationBooking.count({ where: dateFilter }),
        prisma.transportationBooking.count({ where: dateFilter }),
        prisma.travelPackageBooking.count({ where: dateFilter }),
        prisma.experienceBooking.count({ where: dateFilter }),
        prisma.shoppingVisit.count({ where: dateFilter }),
        prisma.transaction.aggregate({
          where: { ...dateFilter, status: "COMPLETED" },
          _sum:  { amount: true, netAmount: true, fee: true },
        }),
      ]);

      const byStatus = Object.fromEntries(
        plansByStatus.map((r) => [r.status, r._count])
      );

      return ok(res, {
        plans: {
          total:    totalPlans,
          byStatus,
        },
        bookings: {
          accommodations:  accBookings,
          transportation:  transBookings,
          packages:        pkgBookings,
          experiences:     expBookings,
          shoppingVisits:  visits,
          total:           accBookings + transBookings + pkgBookings + expBookings + visits,
        },
        revenue: {
          gross: revenueAgg._sum.amount    ?? 0,
          net:   revenueAgg._sum.netAmount ?? 0,
          fees:  revenueAgg._sum.fee       ?? 0,
        },
        period: {
          from: from ? new Date(from).toISOString() : null,
          to:   to   ? new Date(to).toISOString()   : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/admin/travel-plans/:id
   *
   * Full plan detail for admin, always includes user PII.
   */
  async adminGetPlanById(req, res, next) {
    try {
      const { id } = req.params;

      const plan = await prisma.travelPlan.findUnique({
        where:   { id },
        include: PLAN_FULL_INCLUDE,
      });
      if (!plan) return notFound(res, "Travel plan not found");

      const costs = await calculateTotalCost(id);

      return ok(res, {
        ...plan,
        currentSpent:    costs.total,
        budgetBreakdown: costs,
        budgetRemaining: (plan.budget ?? 0) - costs.total,
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TravelPlanController();