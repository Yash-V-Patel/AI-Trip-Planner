const redisConfig = require('../config/redis');

class RedisService {
  constructor() {
    this.client = null;
    this.defaultTTL = 3600; // 1 hour default TTL
    this.tokenTTL = 604800; // 7 days for tokens
    this.permissionTTL = 300; // 5 minutes for permissions
    this.refreshTokenTTL = 7 * 24 * 60 * 60; // 7 days for refresh tokens
  }

  async init() {
    this.client = await redisConfig.connect();
    return this.client;
  }

  // ==================== TOKEN MANAGEMENT (Optimized) ====================

  /**
   * Store refresh token fingerprint in Redis
   * Instead of storing the entire token, store a fingerprint (hashed version)
   * This is more secure and uses less memory
   */
  async storeRefreshTokenFingerprint(userId, refreshToken, metadata = {}) {
    // Create a fingerprint (hash) of the refresh token
    const crypto = require('crypto');
    const fingerprint = crypto
      .createHash('sha256')
      .update(refreshToken + process.env.JWT_REFRESH_SECRET)
      .digest('hex');
    
    const key = `refresh:${userId}:${fingerprint}`;
    
    // Store with 7 days expiry (matching refresh token)
    await this.client.setex(
      key,
      this.refreshTokenTTL,
      JSON.stringify({
        userId,
        fingerprint,
        createdAt: Date.now(),
        ...metadata
      })
    );

    // Add to user's refresh token set for easy management
    await this.client.sadd(`user:refresh:${userId}`, fingerprint);
    
    return fingerprint;
  }

  /**
   * Validate refresh token by checking fingerprint
   */
  async validateRefreshToken(userId, refreshToken) {
    const crypto = require('crypto');
    const fingerprint = crypto
      .createHash('sha256')
      .update(refreshToken + process.env.JWT_REFRESH_SECRET)
      .digest('hex');
    
    const key = `refresh:${userId}:${fingerprint}`;
    const data = await this.client.get(key);
    
    return data ? JSON.parse(data) : null;
  }

  /**
   * Remove refresh token fingerprint
   */
  async removeRefreshTokenFingerprint(userId, refreshToken) {
    const crypto = require('crypto');
    const fingerprint = crypto
      .createHash('sha256')
      .update(refreshToken + process.env.JWT_REFRESH_SECRET)
      .digest('hex');
    
    const key = `refresh:${userId}:${fingerprint}`;
    await this.client.del(key);
    await this.client.srem(`user:refresh:${userId}`, fingerprint);
  }

  /**
   * Remove all refresh tokens for a user
   */
  async removeAllUserRefreshTokens(userId) {
    const fingerprints = await this.client.smembers(`user:refresh:${userId}`);
    
    if (fingerprints.length > 0) {
      const pipeline = this.client.pipeline();
      
      for (const fingerprint of fingerprints) {
        pipeline.del(`refresh:${userId}:${fingerprint}`);
      }
      
      pipeline.del(`user:refresh:${userId}`);
      await pipeline.exec();
    }
  }

  /**
   * Get all active refresh token fingerprints for a user
   */
  async getUserRefreshTokens(userId) {
    return await this.client.smembers(`user:refresh:${userId}`);
  }

  // ==================== ACCESS TOKEN MANAGEMENT ====================

  /**
   * Cache access token for quick lookup
   */
  async cacheAccessToken(userId, token) {
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const key = `token:access:${tokenHash}`;
    await this.client.setex(
      key,
      this.tokenTTL,
      JSON.stringify({ userId, type: 'access' })
    );
  }

  /**
   * Validate access token from cache
   */
  async validateAccessToken(token) {
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const key = `token:access:${tokenHash}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Invalidate/remove access token
   */
  async invalidateAccessToken(token) {
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const key = `token:access:${tokenHash}`;
    await this.client.del(key);
  }

  // ==================== TOKEN BLACKLIST ====================

  /**
   * Blacklist access token until it expires
   */
  async blacklistAccessToken(token, expiryInSeconds) {
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const key = `blacklist:${tokenHash}`;
    await this.client.setex(key, expiryInSeconds, '1');
  }

  /**
   * Check if access token is blacklisted
   */
  async isAccessTokenBlacklisted(token) {
    const crypto = require('crypto');
    const tokenHash = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const key = `blacklist:${tokenHash}`;
    const result = await this.client.get(key);
    return result !== null;
  }

  // ==================== LEGACY TOKEN METHODS (Keep for backward compatibility) ====================

  async cacheUserTokens(userId, tokens) {
    const key = `user:tokens:${userId}`;
    await this.client.setex(
      key, 
      this.tokenTTL, 
      JSON.stringify(tokens)
    );
    
    // Cache individual access token using new method
    if (tokens.accessToken) {
      await this.cacheAccessToken(userId, tokens.accessToken);
    }
  }

  async getUserTokens(userId) {
    const key = `user:tokens:${userId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateUserTokens(userId) {
    const key = `user:tokens:${userId}`;
    const tokens = await this.getUserTokens(userId);
    
    if (tokens && tokens.accessToken) {
      await this.invalidateAccessToken(tokens.accessToken);
    }
    
    // Delete user tokens key
    await this.client.del(key);
  }

  // ==================== USER CACHING ====================

  async cacheUser(userId, userData) {
    const key = `user:data:${userId}`;
    await this.client.setex(
      key,
      this.defaultTTL,
      JSON.stringify(userData)
    );
  }

  async getUser(userId) {
    const key = `user:data:${userId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cacheUserByEmail(email, userData) {
    const key = `user:email:${email}`;
    await this.client.setex(
      key,
      this.defaultTTL,
      JSON.stringify(userData)
    );
  }

  async getUserByEmail(email) {
    const key = `user:email:${email}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateUserCache(userId, email) {
    await this.client.del(`user:data:${userId}`);
    if (email) {
      await this.client.del(`user:email:${email}`);
    }
  }

  // ==================== PROFILE CACHING ====================

  async cacheProfile(userId, profileData) {
    const key = `profile:${userId}`;
    await this.client.setex(
      key,
      this.defaultTTL,
      JSON.stringify(profileData)
    );
  }

  async getProfile(userId) {
    const key = `profile:${userId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateProfile(userId) {
    await this.client.del(`profile:${userId}`);
  }

  // ==================== PERMISSION CACHING (OpenFGA Tuples) ====================

  async cachePermission(userId, object, relation, allowed) {
    const key = `perm:${userId}:${object}:${relation}`;
    await this.client.setex(
      key,
      this.permissionTTL,
      JSON.stringify({ allowed, timestamp: Date.now() })
    );
  }

  async getCachedPermission(userId, object, relation) {
    const key = `perm:${userId}:${object}:${relation}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cacheBatchPermissions(userId, permissions) {
    const pipeline = this.client.pipeline();
    
    for (const { object, relation, allowed } of permissions) {
      const key = `perm:${userId}:${object}:${relation}`;
      pipeline.setex(key, this.permissionTTL, JSON.stringify({ allowed, timestamp: Date.now() }));
    }
    
    await pipeline.exec();
  }

  async invalidatePermission(userId, object, relation) {
    const key = `perm:${userId}:${object}:${relation}`;
    await this.client.del(key);
  }

  async invalidateAllUserPermissions(userId) {
    const pattern = `perm:${userId}:*`;
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }

  // ==================== TRAVEL PLAN CACHING ====================

  async cacheTravelPlan(planId, planData) {
    const key = `travelplan:${planId}`;
    await this.client.setex(
      key,
      this.defaultTTL,
      JSON.stringify(planData)
    );
  }

  async getTravelPlan(planId) {
    const key = `travelplan:${planId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async cacheUserTravelPlans(userId, plans) {
    const key = `user:travelplans:${userId}`;
    await this.client.setex(
      key,
      this.defaultTTL / 2,
      JSON.stringify(plans)
    );
  }

  async getUserTravelPlans(userId) {
    const key = `user:travelplans:${userId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateTravelPlan(planId, userId) {
    await this.client.del(`travelplan:${planId}`);
    await this.client.del(`user:travelplans:${userId}`);
  }

  // ==================== SESSION MANAGEMENT ====================

  async createSession(userId, sessionData) {
    const sessionId = require('crypto').randomBytes(32).toString('hex');
    const key = `session:${sessionId}`;
    
    await this.client.setex(
      key,
      this.tokenTTL,
      JSON.stringify({ userId, ...sessionData, createdAt: Date.now() })
    );
    
    await this.client.sadd(`user:sessions:${userId}`, sessionId);
    
    return sessionId;
  }

  async getSession(sessionId) {
    const key = `session:${sessionId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async destroySession(sessionId) {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.client.srem(`user:sessions:${session.userId}`, sessionId);
    }
    await this.client.del(`session:${sessionId}`);
  }

  async destroyAllUserSessions(userId) {
    const sessions = await this.client.smembers(`user:sessions:${userId}`);
    
    const pipeline = this.client.pipeline();
    for (const sessionId of sessions) {
      pipeline.del(`session:${sessionId}`);
    }
    pipeline.del(`user:sessions:${userId}`);
    
    await pipeline.exec();
  }

  // ==================== RATE LIMITING ====================

  async incrementRateLimit(key, windowSeconds = 60, maxRequests = 60) {
    const current = await this.client.incr(key);
    
    if (current === 1) {
      await this.client.expire(key, windowSeconds);
    }
    
    const ttl = await this.client.ttl(key);
    
    return {
      current,
      remaining: Math.max(0, maxRequests - current),
      reset: ttl
    };
  }

  async checkRateLimit(key, windowSeconds = 60, maxRequests = 60) {
    const current = await this.client.get(key);
    const count = current ? parseInt(current) : 0;
    
    if (count >= maxRequests) {
      const ttl = await this.client.ttl(key);
      return {
        allowed: false,
        remaining: 0,
        reset: ttl
      };
    }
    
    return {
      allowed: true,
      remaining: maxRequests - count,
      reset: await this.client.ttl(key)
    };
  }

  // ==================== LOCKING MECHANISM ====================

  async acquireLock(resource, ttl = 10) {
    const lockKey = `lock:${resource}`;
    const lockValue = require('crypto').randomBytes(16).toString('hex');
    
    const acquired = await this.client.set(
      lockKey,
      lockValue,
      'NX',
      'EX',
      ttl
    );
    
    if (acquired === 'OK') {
      return {
        success: true,
        value: lockValue,
        release: async () => {
          const currentValue = await this.client.get(lockKey);
          if (currentValue === lockValue) {
            await this.client.del(lockKey);
          }
        }
      };
    }
    
    return { success: false };
  }

  // ==================== PUB/SUB ====================

  async publish(channel, message) {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel, callback) {
    const subscriber = redisConfig.getSubscriber();
    await subscriber.subscribe(channel);
    
    subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        callback(JSON.parse(message));
      }
    });
  }

  // ==================== HEALTH CHECK ====================

  async ping() {
    return await this.client.ping();
  }

  async getStats() {
    const info = await this.client.info();
    const stats = {
      connected: redisConfig.isConnected,
      memory: await this.client.info('memory'),
      stats: await this.client.info('stats')
    };
    return stats;
  }

  // ==================== BATCH OPERATIONS ====================

  async mget(keys) {
    return await this.client.mget(keys);
  }

  async mset(entries, ttl = this.defaultTTL) {
    const pipeline = this.client.pipeline();
    
    for (const [key, value] of Object.entries(entries)) {
      pipeline.setex(key, ttl, JSON.stringify(value));
    }
    
    return await pipeline.exec();
  }

  async deletePattern(pattern) {
    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      return await this.client.del(keys);
    }
    return 0;
  }

  // ==================== CLEANUP METHODS ====================

  /**
   * Clean up expired tokens (can be called periodically)
   */
  async cleanupExpiredTokens() {
    // This is handled automatically by Redis TTL
    // But we can add manual cleanup if needed
    return { success: true, message: 'Redis handles TTL automatically' };
  }
}

module.exports = new RedisService();