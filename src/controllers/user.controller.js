"use strict";

const { PrismaClient } = require("@prisma/client");
const redisService = require("../services/redis.service");
const openfgaService = require("../services/openfga.service");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATS_CACHE_TTL_S = 300; // 5 minutes
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Centralised 403 for self-or-admin checks. */
const isSelfOrAdmin = (req, targetId) =>
  req.user.isSuperAdmin || req.user.id === targetId;

const forbidden = (res, msg = "Unauthorized access") =>
  res.status(403).json({ success: false, message: msg });

const notFound = (res, msg = "Resource not found") =>
  res.status(404).json({ success: false, message: msg });

/** Parse positive integer query params with a fallback. */
const parseIntParam = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class UserController {
  // ==================== USER PROFILE ====================

  /**
   * GET /api/users/profile
   */
  
  async getProfile(req, res, next) {
    try {
      const { id: userId } = req.user;
      const skipCache = req.query.skipCache === "true";

      let profile = skipCache ? null : await redisService.getProfile(userId).catch(() => null);

      if (!profile) {
        profile = await prisma.profile.findUnique({
          where: { userId },
          include: {
            user: {
              select: { id: true, email: true, name: true, phone: true, createdAt: true },
            },
          },
        });

        if (!profile) return notFound(res, "Profile not found");

        // Fire-and-forget cache write
        redisService.cacheProfile(userId, profile).catch(() => {});
      }

      return res.json({ success: true, data: profile, cached: !skipCache && !!profile });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/users/profile
   */
  async updateProfile(req, res, next) {
    try {
      const { id: userId } = req.user;
      const updateData = { ...req.body };

      if (updateData.phone) updateData.phone = String(updateData.phone);

      const profile = await prisma.profile.update({
        where: { userId },
        data: updateData,
        include: {
          user: {
            select: { id: true, email: true, name: true, phone: true },
          },
        },
      });

      // Invalidate then re-warm concurrently
      await Promise.allSettled([
        redisService.invalidateProfile(userId),
        redisService.cacheProfile(userId, profile),
      ]);

      return res.json({ success: true, data: profile, message: "Profile updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== USER MANAGEMENT ====================

  /**
   * GET /api/users  (superadmin only)
   */
  async getAllUsers(req, res, next) {
    try {
      if (!req.user.isSuperAdmin) return forbidden(res, "Superadmin access required");

      const page = parseIntParam(req.query.page, DEFAULT_PAGE);
      const limit = parseIntParam(req.query.limit, DEFAULT_LIMIT);
      const skip = (page - 1) * limit;
      const { search } = req.query;

      const where = search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          }
        : {};

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            createdAt: true,
            lastLoginAt: true,
            profile: {
              select: {
                nationality: true,
                language: true,
                accountStatus: true,
              },
            },
            _count: { select: { travelPlans: true } },
          },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        prisma.user.count({ where }),
      ]);

      // Batch OpenFGA checks in parallel instead of sequential N+1
      const adminFlags = await Promise.all(
        users.map((u) => openfgaService.checkSuperAdmin(u.id).catch(() => false))
      );
      const usersWithRoles = users.map((u, i) => ({ ...u, isSuperAdmin: adminFlags[i] }));

      return res.json({
        success: true,
        data: usersWithRoles,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/users/:userId
   */
  async getUserById(req, res, next) {
    try {
      const { userId } = req.params;

      if (!isSelfOrAdmin(req, userId)) return forbidden(res);

      // const skipCache = req.query.skipCache === "true";
      // let user = skipCache ? null : await redisService.getUser(userId).catch(() => null);
      // let fromCache = !!user;

      let user = null;

      if (!user) {
        user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            createdAt: true,
            profile: true,
            travelPlans: {
              select: {
                id: true,
                title: true,
                destination: true,
                startDate: true,
                endDate: true,
                status: true,
              },
            },
          },
        });

        if (!user) return notFound(res, "User not found");

        // Fetch superadmin flag concurrently with cache write
        const [isSuperAdmin] = await Promise.all([
          openfgaService.checkSuperAdmin(user.id).catch(() => false),
          // redisService.cacheUser(userId, user).catch(() => {}),
        ]);

        user = { ...user, isSuperAdmin };
      }

      return res.json({ success: true, data: user});
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/users/:userId
   */
  async updateUser(req, res, next) {
    try {
      const { userId } = req.params;

      if (!isSelfOrAdmin(req, userId)) return forbidden(res);

      const { name, phone, email } = req.body;

      // Fetch existing user to get current email for cache invalidation
      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!existing) return notFound(res, "User not found");

      // Check new email uniqueness only when email is changing
      if (email && email !== existing.email) {
        const conflict = await prisma.user.findFirst({
          where: { email, NOT: { id: userId } },
          select: { id: true },
        });
        if (conflict) {
          return res.status(409).json({ success: false, message: "Email already in use" });
        }
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined && { name }),
          ...(phone !== undefined && { phone: String(phone) }),
          ...(email !== undefined && { email }),
        },
        select: { id: true, email: true, name: true, phone: true, createdAt: true },
      });

      // Invalidate using the OLD email so the old email-keyed cache entry is removed
      // await redisService.invalidateUserCache(userId, existing.email).catch(() => {});

      return res.json({ success: true, data: user, message: "User updated successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/users/:userId  (superadmin only)
   */
  async deleteUser(req, res, next) {
    try {
      if (!req.user.isSuperAdmin) return forbidden(res, "Superadmin access required");

      const { userId } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) return notFound(res, "User not found");

      // Delete DB record first, then clean up asynchronously
      await prisma.user.delete({ where: { id: userId } });

      await Promise.allSettled([

        redisService.invalidateProfile(userId),

        redisService.removeAllUserRefreshTokens(userId),

      ]);

      return res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SESSION MANAGEMENT ====================

  /**
   * GET /api/users/:userId/sessions
   */
  // async getUserSessions(req, res, next) {
  //   try {
  //     const userId = req.params.userId || req.user.id;

  //     if (!isSelfOrAdmin(req, userId)) return forbidden(res);

  //     // const sessionIds = (await redisService.getUserSessions?.(userId)) ?? [];

  //     // Fetch all session details in parallel
  //     // const sessions = await Promise.all(
  //     //   sessionIds.map(async (sessionId) => {
  //     //     const session = await redisService.getSession(sessionId).catch(() => null);
  //     //     return session ? { sessionId, ...session } : null;
  //     //   })
  //     // );

  //     return res.json({ success: true, data: sessions.filter(Boolean) });
  //   } catch (error) {
  //     next(error);
  //   }
  // }

  /**
   * DELETE /api/users/sessions/:sessionId
   */
  // async revokeSession(req, res, next) {
  //   try {
  //     const { sessionId } = req.params



  //     return res.json({ success: true, message: "Session revoked successfully" });
  //   } catch (error) {
  //     next(error);
  //   }
  // }

  /**
   * DELETE /api/users/:userId/sessions
   */
  async revokeAllSessions(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;

      if (!isSelfOrAdmin(req, userId)) return forbidden(res);

      await Promise.all([

        redisService.removeAllUserRefreshTokens(userId),

      ]);

      return res.json({ success: true, message: "All sessions revoked successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN MANAGEMENT ====================

  /**
   * POST /api/users/:userId/superadmin
   */
  async assignSuperAdmin(req, res, next) {
    try {
      if (!req.user.isSuperAdmin) return forbidden(res, "Superadmin access required");

      const { userId } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) return notFound(res, "User not found");

      await Promise.all([
        openfgaService.assignSuperAdmin(userId),

      ]);

      return res.json({ success: true, message: "Superadmin assigned successfully" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/users/:userId/superadmin
   */
  async removeSuperAdmin(req, res, next) {
    try {
      if (!req.user.isSuperAdmin) return forbidden(res, "Superadmin access required");

      const { userId } = req.params;

      if (req.user.id === userId) {
        return res.status(400).json({
          success: false,
          message: "Cannot remove your own superadmin status",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (!user) return notFound(res, "User not found");

      await Promise.all([
        openfgaService.removeSuperAdmin(userId),  
      ]);

      return res.json({ success: true, message: "Superadmin removed successfully" });
    } catch (error) {
      next(error);
    }
  }

  // ==================== USER STATISTICS ====================

  /**
   * GET /api/users/:userId/statistics
   */
  async getUserStatistics(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;

      if (!isSelfOrAdmin(req, userId)) return forbidden(res);

      const skipCache = req.query.skipCache === "true";
      const cacheKey = `stats:${userId}`;

      if (!skipCache) {
        const cached = await redisService.client?.get(cacheKey).catch(() => null);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached), cached: true });
        }
      }

      // Single transaction — all 8 counts in one round-trip
      const [
        totalTravelPlans,
        completedTravelPlans,
        planningTravelPlans,
        ongoingTravelPlans,
        totalAccommodations,
        totalTransportations,
        totalShoppingVisits,
        totalExperiences,
      ] = await prisma.$transaction([
        prisma.travelPlan.count({ where: { userId } }),
        prisma.travelPlan.count({ where: { userId, status: "COMPLETED" } }),
        prisma.travelPlan.count({ where: { userId, status: "PLANNING" } }),
        prisma.travelPlan.count({ where: { userId, status: "ONGOING" } }),
        prisma.accommodationBooking.count({ where: { travelPlan: { userId } } }),
        prisma.transportationBooking.count({ where: { travelPlan: { userId } } }),
        prisma.shoppingVisit.count({ where: { travelPlan: { userId } } }),
        prisma.travelExperience.count({ where: { travelPlan: { userId } } }),
      ]);

      const statistics = {
        totalTravelPlans,
        completedTravelPlans,
        planningTravelPlans,
        ongoingTravelPlans,
        totalAccommodations,
        totalTransportations,
        totalShoppingVisits,
        totalExperiences,
      };

      // Fire-and-forget cache write
      redisService.client
        ?.setex(cacheKey, STATS_CACHE_TTL_S, JSON.stringify(statistics))
        .catch(() => {});

      return res.json({ success: true, data: statistics, cached: false });
    } catch (error) {
      next(error);
    }
  }

  // ==================== CACHE MANAGEMENT ====================

  /**
   * DELETE /api/users/cache  (superadmin only)
   */
  async clearCache(req, res, next) {
    try {
      if (!req.user.isSuperAdmin) return forbidden(res, "Superadmin access required");

      const { userId, pattern } = req.query;

      if (userId) {
        await Promise.allSettled([
          redisService.invalidateUserCache(userId),
          redisService.invalidateProfile(userId),
          redisService.removeAllUserRefreshTokens(userId),
        ]);
      } else if (pattern) {
        await redisService.deletePattern(pattern);
      } else {
        // Dangerous — flush everything
        await redisService.client?.flushall();
      }

      return res.json({ success: true, message: "Cache cleared successfully" });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();