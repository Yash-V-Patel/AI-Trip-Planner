const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const openfgaService = require('../services/openfga.service');
const redisService = require('../services/redis.service');

const prisma = new PrismaClient();

class AuthMiddleware {
   constructor() {
    // Bind methods to ensure 'this' context
    this.authenticate = this.authenticate.bind(this);
    this.requirePermission = this.requirePermission.bind(this);
    this.rateLimit = this.rateLimit.bind(this);
    this.requireSuperAdmin = this.requireSuperAdmin.bind(this);
    this.extractToken = this.extractToken.bind(this);
  }

  async authenticate(req, res, next) {
    try {
      const token = this.extractToken(req);
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authentication token required'
        });
      }

      // Check Redis cache first
      let cachedToken;
      try {
        cachedToken = await redisService.validateAccessToken(token);
      } catch (redisError) {
        // Continue without Redis
      }
      
      if (cachedToken) {
        // Get user from cache
        let user = await redisService.getUser(cachedToken.userId);
        
        if (!user) {
          // If user not in cache, get from DB and cache it
          const dbUser = await prisma.user.findUnique({
            where: { id: cachedToken.userId },
            include: { profile: true }
          });

          if (dbUser) {
            user = {
              id: dbUser.id,
              email: dbUser.email,
              name: dbUser.name,
              phone: dbUser.phone,
              profile: dbUser.profile
            };
            await redisService.cacheUser(user.id, user);
          }
        }

        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'User not found'
          });
        }

        // Check superadmin status from cache
        const cachedPermission = await redisService.getCachedPermission(
          user.id,
          'superadmin:global',
          'can_manage_all'
        );

        let isSuperAdmin = false;
        if (cachedPermission) {
          isSuperAdmin = cachedPermission.allowed;
        } else {
          isSuperAdmin = await openfgaService.checkSuperAdmin(user.id);
          await redisService.cachePermission(
            user.id,
            'superadmin:global',
            'can_manage_all',
            isSuperAdmin
          );
        }

        req.user = {
          ...user,
          isSuperAdmin
        };

        return next();
      }

      // If not in cache, verify JWT
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      
      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { profile: true }
      });

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check superadmin status
      const isSuperAdmin = await openfgaService.checkSuperAdmin(user.id);

      // Cache the token for future requests
      await redisService.cacheUserTokens(user.id, { accessToken: token });
      
      // Cache user data
      const userData = {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        profile: user.profile
      };
      await redisService.cacheUser(user.id, userData);

      // Cache permission
      await redisService.cachePermission(
        user.id,
        'superadmin:global',
        'can_manage_all',
        isSuperAdmin
      );

      req.user = {
        ...userData,
        isSuperAdmin
      };

      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // Clean up expired token from Redis if it exists
        try {
          const token = this.extractToken(req);
          if (token) {
            await redisService.invalidateAccessToken(token);
          }
        } catch (cleanupError) {
          // Ignore cleanup errors
        }

        return res.status(401).json({
          success: false,
          message: 'Token expired'
        });
      }
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token'
        });
      }

      next(error);
    }
  }

  // Permission-based authorization with Redis caching
  requirePermission(objectType, relation) {
    return async (req, res, next) => {
      try {
        const objectId = req.params.id;
        if (!objectId) {
          return res.status(400).json({
            success: false,
            message: 'Object ID required'
          });
        }

        const object = `${objectType}:${objectId}`;
        
        // Check Redis cache first
        const cachedPermission = await redisService.getCachedPermission(
          req.user.id,
          object,
          relation
        );

        if (cachedPermission) {
          if (cachedPermission.allowed || req.user.isSuperAdmin) {
            return next();
          } else {
            return res.status(403).json({
              success: false,
              message: 'Insufficient permissions'
            });
          }
        }

        // If not in cache, check OpenFGA
        const hasPermission = await openfgaService.checkPermission(
          req.user.id,
          relation,
          object
        );

        // Cache the result
        await redisService.cachePermission(
          req.user.id,
          object,
          relation,
          hasPermission
        );

        if (!hasPermission && !req.user.isSuperAdmin) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions'
          });
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  // Rate limiting middleware using Redis
  rateLimit(options = {}) {
    const {
      windowMs = 60 * 1000,
      max = 60,
      keyPrefix = 'rate_limit'
    } = options;

    return async (req, res, next) => {
      const key = `${keyPrefix}:${req.ip}:${req.path}`;
      
      try {
        const result = await redisService.incrementRateLimit(
          key,
          windowMs / 1000,
          max
        );

        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': result.remaining,
          'X-RateLimit-Reset': result.reset
        });

        if (result.current > max) {
          return res.status(429).json({
            success: false,
            message: 'Too many requests, please try again later.'
          });
        }

        next();
      } catch (error) {
        next();
      }
    };
  }

  requireSuperAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      if (!req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Superadmin access required'
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }
}

module.exports = new AuthMiddleware();