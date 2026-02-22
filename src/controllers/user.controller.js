const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const redisService = require('../services/redis.service');
const openfgaService = require('../services/openfga.service');
const { generateTokens } = require('../utils/jwt.utils');

const prisma = new PrismaClient();

class UserController {
  // ==================== USER PROFILE ====================

  /**
   * Get user profile
   * GET /api/users/profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.id;
      
      // Try cache first
      let profile = await redisService.getProfile(userId);
      
      if (!profile || req.query.skipCache) {
        profile = await prisma.profile.findUnique({
          where: { userId },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                createdAt: true
              }
            }
          }
        });

        if (!profile) {
          return res.status(404).json({
            success: false,
            message: 'Profile not found'
          });
        }

        // Cache profile
        await redisService.cacheProfile(userId, profile);
      }

      res.json({
        success: true,
        data: profile,
        cached: !req.query.skipCache && !!profile
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user profile
   * PUT /api/users/profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const updateData = req.body;

      // Convert phone to string if present
      if (updateData.phone) {
        updateData.phone = String(updateData.phone);
      }

      const profile = await prisma.profile.update({
        where: { userId },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              phone: true
            }
          }
        }
      });

      // Invalidate profile cache
      await redisService.invalidateProfile(userId);
      
      // Cache updated profile
      await redisService.cacheProfile(userId, profile);

      res.json({
        success: true,
        data: profile,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== USER MANAGEMENT ====================

  /**
   * Get all users (superadmin only)
   * GET /api/users
   */
  async getAllUsers(req, res, next) {
    try {
      // Check superadmin
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      const { page = 1, limit = 10, search } = req.query;
      const skip = (page - 1) * limit;

      // Build search filter
      const where = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Get users with pagination
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            createdAt: true,
            profile: {
              select: {
                nationality: true,
                language: true,
                accountStatus: true,
                lastLogin: true
              }
            },
            _count: {
              select: {
                travelPlans: true
              }
            }
          },
          skip: parseInt(skip),
          take: parseInt(limit),
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where })
      ]);

      // Check superadmin status for each user
      const usersWithRoles = await Promise.all(
        users.map(async (user) => {
          const isSuperAdmin = await openfgaService.checkSuperAdmin(user.id);
          return { ...user, isSuperAdmin };
        })
      );

      res.json({
        success: true,
        data: usersWithRoles,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user by ID
   * GET /api/users/:userId
   */
  async getUserById(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      // Try cache first
      let user = await redisService.getUser(userId);
      
      if (!user || req.query.skipCache) {
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
                status: true
              }
            }
          }
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        // Check superadmin status
        const isSuperAdmin = await openfgaService.checkSuperAdmin(user.id);
        user = { ...user, isSuperAdmin };

        // Cache user data
        await redisService.cacheUser(userId, user);
      }

      res.json({
        success: true,
        data: user,
        cached: !req.query.skipCache
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user
   * PUT /api/users/:userId
   */
  async updateUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      const { name, phone, email } = req.body;

      // Check email uniqueness
      if (email) {
        const existingUser = await prisma.user.findFirst({
          where: {
            email,
            NOT: { id: userId }
          }
        });

        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Email already in use'
          });
        }
      }

      // Update user
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          name,
          phone: phone ? String(phone) : undefined,
          email
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          createdAt: true
        }
      });

      // Invalidate user cache
      await redisService.invalidateUserCache(userId, req.user.email);

      res.json({
        success: true,
        data: user,
        message: 'User updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete user (superadmin only)
   * DELETE /api/users/:userId
   */
  async deleteUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check superadmin
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      // Get user email
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Delete user
      await prisma.user.delete({
        where: { id: userId }
      });

      // Clean up all user data
      await Promise.all([
        redisService.invalidateUserCache(userId, user.email),
        redisService.invalidateProfile(userId),
        redisService.invalidateAllUserPermissions(userId),
        redisService.removeAllUserRefreshTokens(userId),
        redisService.destroyAllUserSessions(userId)
      ]);

      res.json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SESSION MANAGEMENT ====================

  /**
   * Get user sessions
   * GET /api/users/:userId/sessions
   */
  async getUserSessions(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;
      
      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      // Get session IDs from Redis
      const sessionIds = await redisService.getUserSessions?.(userId) || [];
      
      // Get session details
      const sessions = await Promise.all(
        sessionIds.map(async (sessionId) => {
          const session = await redisService.getSession(sessionId);
          return { sessionId, ...session };
        })
      );

      res.json({
        success: true,
        data: sessions
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke specific session
   * DELETE /api/users/sessions/:sessionId
   */
  async revokeSession(req, res, next) {
    try {
      const { sessionId } = req.params;
      
      const session = await redisService.getSession(sessionId);
      
      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Session not found'
        });
      }

      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== session.userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      await redisService.destroySession(sessionId);

      res.json({
        success: true,
        message: 'Session revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke all sessions
   * DELETE /api/users/:userId/sessions
   */
  async revokeAllSessions(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;
      
      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      await Promise.all([
        redisService.destroyAllUserSessions(userId),
        redisService.removeAllUserRefreshTokens(userId),
        redisService.invalidateUserTokens(userId)
      ]);

      res.json({
        success: true,
        message: 'All sessions revoked successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SUPERADMIN MANAGEMENT ====================

  /**
   * Assign superadmin role
   * POST /api/users/:userId/superadmin
   */
  async assignSuperAdmin(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check superadmin
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Assign superadmin
      await openfgaService.assignSuperAdmin(userId);

      // Invalidate user cache
      await redisService.invalidateUserCache(userId, user.email);

      res.json({
        success: true,
        message: 'Superadmin assigned successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove superadmin role
   * DELETE /api/users/:userId/superadmin
   */
  async removeSuperAdmin(req, res, next) {
    try {
      const { userId } = req.params;
      
      // Check superadmin
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      // Prevent self-removal
      if (req.user.id === userId) {
        return res.status(400).json({
          success: false,
          message: 'Cannot remove your own superadmin status'
        });
      }

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Remove superadmin
      await openfgaService.removeSuperAdmin(userId);

      // Invalidate user cache
      await redisService.invalidateUserCache(userId, user.email);

      res.json({
        success: true,
        message: 'Superadmin removed successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== USER STATISTICS ====================

  /**
   * Get user statistics
   * GET /api/users/:userId/statistics
   */
  async getUserStatistics(req, res, next) {
    try {
      const userId = req.params.userId || req.user.id;
      
      // Check permission
      if (!req.user.isSuperAdmin && req.user.id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized access'
        });
      }

      // Try cache first
      const cacheKey = `stats:${userId}`;
      let statistics = await redisService.client?.get(cacheKey);
      
      if (statistics && !req.query.skipCache) {
        return res.json({
          success: true,
          data: JSON.parse(statistics),
          cached: true
        });
      }

      // Calculate statistics
      const stats = await prisma.$transaction([
        prisma.travelPlan.count({ where: { userId } }),
        prisma.travelPlan.count({ where: { userId, status: 'COMPLETED' } }),
        prisma.travelPlan.count({ where: { userId, status: 'PLANNING' } }),
        prisma.travelPlan.count({ where: { userId, status: 'ONGOING' } }),
        prisma.accommodationBooking.count({ 
          where: { travelPlan: { userId } } 
        }),
        prisma.transportationBooking.count({ 
          where: { travelPlan: { userId } } 
        }),
        prisma.shoppingVisit.count({ 
          where: { travelPlan: { userId } } 
        }),
        prisma.travelExperience.count({ 
          where: { travelPlan: { userId } } 
        })
      ]);

      statistics = {
        totalTravelPlans: stats[0],
        completedTravelPlans: stats[1],
        planningTravelPlans: stats[2],
        ongoingTravelPlans: stats[3],
        totalAccommodations: stats[4],
        totalTransportations: stats[5],
        totalShoppingVisits: stats[6],
        totalExperiences: stats[7]
      };

      // Cache for 5 minutes
      await redisService.client?.setex(cacheKey, 300, JSON.stringify(statistics));

      res.json({
        success: true,
        data: statistics,
        cached: false
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== CACHE MANAGEMENT ====================

  /**
   * Clear cache (superadmin only)
   * DELETE /api/users/cache
   */
  async clearCache(req, res, next) {
    try {
      // Check superadmin
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      const { userId, pattern } = req.query;

      if (userId) {
        // Clear specific user's cache
        await Promise.all([
          redisService.invalidateUserCache(userId),
          redisService.invalidateProfile(userId),
          redisService.invalidateAllUserPermissions(userId),
          redisService.removeAllUserRefreshTokens(userId)
        ]);
      } else if (pattern) {
        // Clear by pattern
        await redisService.deletePattern(pattern);
      } else {
        // Clear all cache (use with caution)
        await redisService.client?.flushall();
      }

      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();