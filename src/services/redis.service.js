"use strict";

/**
 * redis.service.js
 *
 * Intentionally minimal. Redis stores only two categories of data:
 *
 *   1. Refresh-token fingerprints  — enables server-side session revocation
 *      without relying solely on JWT expiry.
 *
 *   2. User profile cache          — profile changes rarely; caching it
 *      avoids a DB hit on every authenticated request that needs profile data.
 *
 * Access tokens are validated by verifying the JWT signature directly —
 * no Redis round-trip required. Tokens travel via httpOnly cookies, not
 * Authorization headers (though the header is still accepted as a fallback).
 *
 * Utility sections (rate-limiting, distributed lock, deletePattern, pub/sub,
 * health checks) are kept for infrastructure use across the codebase.
 */

const crypto      = require("crypto");
const redisConfig = require("../config/redis");

// ─── TTL constants (seconds) ─────────────────────────────────────────────────

const TTL = {
  PROFILE:       2 * 60 * 60,        // 2 h — profile cache
  REFRESH_TOKEN: 7 * 24 * 60 * 60,   // 7 d — matches JWT refresh expiry
};

// ─── internal helper ─────────────────────────────────────────────────────────

/**
 * HMAC-SHA-256 of (token + secret) — deterministic, one-way fingerprint.
 * The raw token is never written to Redis.
 */
const makeFingerprint = (token) =>
  crypto
    .createHmac("sha256", process.env.JWT_REFRESH_SECRET ?? "fallback")
    .update(token)
    .digest("hex");

// ─── service ─────────────────────────────────────────────────────────────────

class RedisService {
  constructor() {
    /** @type {import('ioredis').Redis | null} */
    this.client = null;

    // Expose so controllers can reference TTLs without magic numbers
    this.TTL = TTL;
  }

  async init() {
    this.client = await redisConfig.connect();
    return this.client;
  }

  // ==================== REFRESH TOKEN FINGERPRINTS ====================
  //
  // Key layout:
  //   refresh:{userId}:{fingerprint}  →  JSON metadata   TTL = 7 d
  //   user:refresh:{userId}           →  Redis SET of active fingerprints
  //
  // The SET lets us enumerate / revoke ALL sessions for a user in O(n).

  /**
   * Persist a new refresh-token fingerprint after login / register / token rotation.
   *
   * @param {string} userId
   * @param {string} refreshToken   raw JWT string (never stored, only hashed)
   * @param {object} [metadata]     e.g. { ip, userAgent, loginTime }
   * @returns {string|null} fingerprint
   */
  async storeRefreshTokenFingerprint(userId, refreshToken, metadata = {}) {
    if (!this.client) return null;

    const fp  = makeFingerprint(refreshToken);
    const key = `refresh:${userId}:${fp}`;

    const pipeline = this.client.pipeline();
    pipeline.setex(
      key,
      TTL.REFRESH_TOKEN,
      JSON.stringify({ userId, fingerprint: fp, createdAt: Date.now(), ...metadata })
    );
    pipeline.sadd(`user:refresh:${userId}`, fp);
    pipeline.expire(`user:refresh:${userId}`, TTL.REFRESH_TOKEN);
    await pipeline.exec();

    return fp;
  }

  /**
   * Validate a refresh token.
   * Returns the stored metadata object if valid, or null if revoked / expired / absent.
   *
   * @param {string} userId
   * @param {string} refreshToken
   * @returns {object|null}
   */
  async validateRefreshToken(userId, refreshToken) {
    if (!this.client) return null;

    const fp   = makeFingerprint(refreshToken);
    const data = await this.client.get(`refresh:${userId}:${fp}`).catch(() => null);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Revoke a single refresh token (single-session logout).
   *
   * @param {string} userId
   * @param {string} refreshToken
   */
  async removeRefreshTokenFingerprint(userId, refreshToken) {
    if (!this.client) return;

    const fp       = makeFingerprint(refreshToken);
    const pipeline = this.client.pipeline();
    pipeline.del(`refresh:${userId}:${fp}`);
    pipeline.srem(`user:refresh:${userId}`, fp);
    await pipeline.exec();
  }

  /**
   * Revoke ALL refresh tokens for a user (all-session logout, password change).
   *
   * @param {string} userId
   */
  async removeAllUserRefreshTokens(userId) {
    if (!this.client) return;

    const fingerprints = await this.client.smembers(`user:refresh:${userId}`).catch(() => []);
    if (!fingerprints.length) return;

    const pipeline = this.client.pipeline();
    for (const fp of fingerprints) {
      pipeline.del(`refresh:${userId}:${fp}`);
    }
    pipeline.del(`user:refresh:${userId}`);
    await pipeline.exec();
  }

  /**
   * Return all active fingerprints for a user (useful for a "manage devices" screen).
   *
   * @param {string} userId
   * @returns {string[]}
   */
  async getUserRefreshTokens(userId) {
    if (!this.client) return [];
    return this.client.smembers(`user:refresh:${userId}`).catch(() => []);
  }

  // ==================== PROFILE CACHE ====================
  //
  // Profile is read on nearly every authenticated request.
  // Key: profile:{userId}   TTL: 2 h
  // Invalidate on any profile write.

  /**
   * Write a user's profile to cache.
   *
   * @param {string} userId
   * @param {object} profileData
   */
  async cacheProfile(userId, profileData) {
    if (!this.client) return;
    this.client
      .setex(`profile:${userId}`, TTL.PROFILE, JSON.stringify(profileData))
      .catch(() => {});
  }

  /**
   * Read a user's profile from cache. Returns null on miss or error.
   *
   * @param {string} userId
   * @returns {object|null}
   */
  async getProfile(userId) {
    if (!this.client) return null;
    const data = await this.client.get(`profile:${userId}`).catch(() => null);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Evict a user's profile from cache. Call after any profile update.
   *
   * @param {string} userId
   */
  async invalidateProfile(userId) {
    if (!this.client) return;
    this.client.del(`profile:${userId}`).catch(() => {});
  }

  // ==================== RATE LIMITING ====================

  /**
   * Increment the request counter for `key` and return the window state.
   * Uses a pipeline to keep the incr + ttl check in a single round-trip.
   *
   * @param {string} key
   * @param {number} windowSeconds
   * @param {number} maxRequests
   * @returns {{ current: number, remaining: number, reset: number }}
   */
  async incrementRateLimit(key, windowSeconds = 60, maxRequests = 60) {
    if (!this.client) return { current: 0, remaining: maxRequests, reset: windowSeconds };

    const pipeline                       = this.client.pipeline();
    pipeline.incr(key);
    pipeline.ttl(key);
    const [[, current], [, ttl]]         = await pipeline.exec();

    // Set expiry only on the very first request in a new window
    if (current === 1) {
      this.client.expire(key, windowSeconds).catch(() => {});
    }

    const resetIn = ttl > 0 ? ttl : windowSeconds;
    return {
      current,
      remaining: Math.max(0, maxRequests - current),
      reset:     resetIn,
    };
  }

  /**
   * Peek at the rate-limit state without incrementing.
   *
   * @param {string} key
   * @param {number} windowSeconds
   * @param {number} maxRequests
   * @returns {{ allowed: boolean, remaining: number, reset: number }}
   */
  async checkRateLimit(key, windowSeconds = 60, maxRequests = 60) {
    if (!this.client) return { allowed: true, remaining: maxRequests, reset: 0 };

    const [raw, ttl] = await Promise.all([
      this.client.get(key).catch(() => null),
      this.client.ttl(key).catch(() => -1),
    ]);

    const count   = raw ? parseInt(raw, 10) : 0;
    const resetIn = ttl > 0 ? ttl : windowSeconds;

    return count >= maxRequests
      ? { allowed: false, remaining: 0, reset: resetIn }
      : { allowed: true,  remaining: maxRequests - count, reset: resetIn };
  }

  // ==================== DISTRIBUTED LOCK ====================

  /**
   * Acquire a Redis lock for `resource`.
   * Returns `{ success: true, release }` on success, `{ success: false }` otherwise.
   *
   * @param {string} resource   logical name, e.g. "payout:vendor:abc"
   * @param {number} ttl        lock expiry in seconds
   */
  async acquireLock(resource, ttl = 10) {
    if (!this.client) return { success: false };

    const lockKey   = `lock:${resource}`;
    const lockValue = crypto.randomBytes(16).toString("hex");
    const acquired  = await this.client.set(lockKey, lockValue, "NX", "EX", ttl);

    if (acquired !== "OK") return { success: false };

    return {
      success: true,
      value:   lockValue,
      release: async () => {
        const current = await this.client.get(lockKey).catch(() => null);
        if (current === lockValue) {
          this.client.del(lockKey).catch(() => {});
        }
      },
    };
  }

  // ==================== PATTERN DELETE ====================

  /**
   * Delete all keys matching a glob pattern using a non-blocking SCAN cursor.
   * NEVER use KEYS in production — it blocks the entire Redis server.
   *
   * Used by controllers to invalidate list caches after mutations, e.g.:
   *   redisService.deletePattern("accommodations:list:*")
   *
   * @param {string} pattern
   * @returns {number} count of deleted keys
   */
  async deletePattern(pattern) {
    if (!this.client) return 0;

    let cursor  = "0";
    let deleted = 0;

    do {
      const [next, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;

      // Batch at 500 to avoid an oversized single DEL command
      for (let i = 0; i < keys.length; i += 500) {
        const batch = keys.slice(i, i + 500);
        if (batch.length) deleted += await this.client.del(...batch).catch(() => 0);
      }
    } while (cursor !== "0");

    return deleted;
  }

  // ==================== PUB / SUB ====================

  async publish(channel, message) {
    if (!this.client) return;
    await this.client.publish(channel, JSON.stringify(message)).catch(() => {});
  }

  async subscribe(channel, callback) {
    const subscriber = redisConfig.getSubscriber();
    await subscriber.subscribe(channel);
    subscriber.on("message", (ch, message) => {
      if (ch === channel) callback(JSON.parse(message));
    });
  }

  // ==================== HEALTH ====================

  async ping() {
    if (!this.client) return null;
    return this.client.ping().catch(() => null);
  }

  async getStats() {
    if (!this.client) return { connected: false };
    return {
      connected: redisConfig.isConnected ?? true,
      memory:    await this.client.info("memory").catch(() => null),
      stats:     await this.client.info("stats").catch(() => null),
    };
  }

  // ==================== BATCH HELPERS ====================

  async mget(keys) {
    if (!this.client) return keys.map(() => null);
    return this.client.mget(keys).catch(() => keys.map(() => null));
  }

  /**
   * @param {Record<string, any>} entries
   * @param {number|null}         ttl     defaults to TTL.PROFILE
   */
  async mset(entries, ttl = null) {
    if (!this.client) return;
    const resolvedTtl = ttl ?? TTL.PROFILE;
    const pipeline    = this.client.pipeline();
    for (const [key, value] of Object.entries(entries)) {
      pipeline.setex(key, resolvedTtl, JSON.stringify(value));
    }
    return pipeline.exec().catch(() => {});
  }
}

module.exports = new RedisService();