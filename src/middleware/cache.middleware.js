const redisService = require('../services/redis.service');

class CacheMiddleware {
  constructor() {
    this.defaultTTL = 300; // 5 minutes
  }

  // Cache user data
  cacheUser(options = {}) {
    const { ttl = 300, keyPrefix = 'user' } = options;
    
    return async (req, res, next) => {
      const userId = req.user?.id || req.params.userId;
      
      if (!userId) {
        return next();
      }

      const cacheKey = `${keyPrefix}:${userId}`;
      
      try {
        // Try to get from cache
        const cachedData = await redisService.getUser(userId);
        
        if (cachedData && !req.query.skipCache) {
          req.userCache = {
            hit: true,
            data: cachedData
          };
          
          // Add cache header
          res.set('X-Cache', 'HIT');
          return next();
        }

        // Cache miss, will be populated after response
        res.set('X-Cache', 'MISS');
        req.cacheKey = cacheKey;
        req.shouldCache = true;
        req.cacheTTL = ttl;
        
        // Store original json method
        const originalJson = res.json;
        
        res.json = function(data) {
          if (req.shouldCache && data.success && data.data) {
            redisService.cacheUser(userId, data.data)
              .catch(err => console.error('Cache set error:', err));
          }
          originalJson.call(this, data);
        };
        
        next();
      } catch (error) {
        console.error('Cache middleware error:', error);
        next();
      }
    };
  }

  // Cache travel plans
  cacheTravelPlans(options = {}) {
    const { ttl = 300 } = options;
    
    return async (req, res, next) => {
      const userId = req.user?.id;
      const planId = req.params.id;
      
      if (!userId) {
        return next();
      }

      try {
        if (planId) {
          // Single plan caching
          const cachedPlan = await redisService.getTravelPlan(planId);
          
          if (cachedPlan && !req.query.skipCache) {
            req.planCache = {
              hit: true,
              data: cachedPlan
            };
            res.set('X-Cache', 'HIT');
            return next();
          }

          res.set('X-Cache', 'MISS');
          
          // Store original json
          const originalJson = res.json;
          
          res.json = function(data) {
            if (data.success && data.data) {
              redisService.cacheTravelPlan(planId, data.data)
                .catch(err => console.error('Cache set error:', err));
            }
            originalJson.call(this, data);
          };
        } else {
          // List caching
          const cachedPlans = await redisService.getUserTravelPlans(userId);
          
          if (cachedPlans && !req.query.skipCache) {
            req.plansCache = {
              hit: true,
              data: cachedPlans
            };
            res.set('X-Cache', 'HIT');
            return next();
          }

          res.set('X-Cache', 'MISS');
          
          const originalJson = res.json;
          
          res.json = function(data) {
            if (data.success && data.data) {
              redisService.cacheUserTravelPlans(userId, data.data)
                .catch(err => console.error('Cache set error:', err));
            }
            originalJson.call(this, data);
          };
        }
        
        next();
      } catch (error) {
        console.error('Travel plan cache error:', error);
        next();
      }
    };
  }

  // Permission caching
  cachePermission(permissionType) {
    return async (req, res, next) => {
      const userId = req.user?.id;
      const objectId = req.params.id;
      
      if (!userId || !objectId) {
        return next();
      }

      const object = `${permissionType}:${objectId}`;
      
      try {
        // Check cached permission
        const cached = await redisService.getCachedPermission(
          userId, 
          object, 
          'can_view'
        );

        if (cached) {
          req.permissionCache = {
            hit: true,
            allowed: cached.allowed
          };
          res.set('X-Permission-Cache', 'HIT');
          
          if (!cached.allowed) {
            return res.status(403).json({
              success: false,
              message: 'Insufficient permissions'
            });
          }
          
          return next();
        }

        res.set('X-Permission-Cache', 'MISS');
        next();
      } catch (error) {
        console.error('Permission cache error:', error);
        next();
      }
    };
  }

  // Clear cache for specific resources
  async clearCache(req, res, next) {
    const { userId, planId, type } = req.query;
    
    try {
      if (userId) {
        await redisService.invalidateUserCache(userId, req.user?.email);
        await redisService.invalidateProfile(userId);
        await redisService.invalidateAllUserPermissions(userId);
      }
      
      if (planId && userId) {
        await redisService.invalidateTravelPlan(planId, userId);
      }
      
      if (type === 'all' && req.user?.isSuperAdmin) {
        await redisService.deletePattern('*');
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

module.exports = new CacheMiddleware();